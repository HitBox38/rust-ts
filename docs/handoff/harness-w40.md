# Handoff: harness-w40 (harness and tools batch)

Branch `t3/implement-harness-w40`, on `integ-w40` (merge `5eda654d`). Nothing edits a baseline, `harness/scope.json`, or an oracle output.

| Item | Result |
|---|---|
| 1. Thread-id mask | **Done**, `1e68250a`, follow-up `6995ea20`. **Not every case moves to MATCH: see the warning below** |
| 2. `coverage.ts` markers and order | **Done**, `a893af2a`. 917 markers out of order, report only |
| 3. `gate.json` retry times | **Done**, `2c656000` |
| 4. `supertrait-hint-cycle.rs` | **Done**, `2a3d381a`, follow-up `b3ec954e`. New suite `mir-heavy`, out of gate defaults |
| 5. Long-type digits | **Done**, `246b699e`. 6 cases UNSTABLE to MATCH |
| 6. `parse`, `RUSTC_ICE=0` | **Done**, `b5528aef`: the real cost is small, about 5 min once and 457 MB |
| 7. `plan-m7.md`, `mir-opt-o4` | **Done**, `e130f792`. It is **60 of 406**, not 53 |
| 8a. Mono generated sets | **Done**, `44a363ef` |
| 8b. Long error descriptions | **Done**, `763fbfff`. 7 `miri-fail` cases to MATCH |

**Warning for root, item 1.** You asked me to show that no case moves except to MATCH. **That does not hold, and I did not make it hold.** Of the 44 cases the mask frees, 18 MATCH, 25 become DIFF and 1 becomes UNPORTED. All 26 are native backtrace frames under `RUST_BACKTRACE=short` or `1`, which the port cannot print and `docs/reviews/plan-ice-report.md` put out of scope. `docs/handoff/ice-report-impl.md` 5.2 predicted this ("MATCH, DIFF or UNPORTED"). None was protected, so nothing can be lost, and DIFF is the honest status: their oracle output is reproducible once masked.

## 1. The thread-id mask

### Status changes, across every suite

The last gate (`gate-20261105-081912-root-ygiz`) had 51 UNSTABLE cases. Run on `5eda654d` and on the head, by difftest on exactly these cases. None is in a baseline.

| Suite | Cases | MATCH | DIFF | UNPORTED | Still UNSTABLE |
|---|---|---|---|---|---|
| `mir` | 14 | 14 | | | |
| `pm-ui` | 2 | 2 | | | |
| `pm-expanded` | 1 | 1 | | | |
| `mirdump-ui` | 4 | 1 | 2 | 1 | |
| `tydump-ui` | 6 | | 6 | | |
| `thirdump-ui` | 6 | | 6 | | |
| `thir-tree` | 7 | | 7 | | |
| `mir-o2` | 3 | | 3 | | |
| `miri-pass` | 2 | | 1 | | 1 (`panic1.rs`, correctly) |
| **Item 1** | **45** | **18** | **25** | **1** | **1** |
| Item 5: `tydump-ui`, `thirdump-ui`, `thir-tree`, 2 each | 6 | 6 | | | |

**The 18 that MATCH:**

- `mir`: `borrowck/borrowck-describe-field-generic-param-owned-box.rs`, `consts/const-eval/do_not_const_check.rs`, `mir/validate/noncleanup-{cleanup,resume,terminate}.rs`, `move-expr/name-resolution.rs`, `simd/intrinsic/{generic-arithmetic-saturating-2,generic-gather-scatter,generic-select,generic-shuffle,inlining-issue67557-ice}.rs`, `simd/masked-load-store-build-fail.rs`, `simd/shuffle.rs`, `track-diagnostics/track.rs`
- `pm-ui`: `proc-macro/load-panic-backtrace.rs`, `resolve/proc_macro_generated_packed.rs`
- `pm-expanded`: `proc-macro/load-panic-backtrace.rs`
- `mirdump-ui`: `mir/lint/storage-live.rs`

**The 26 that do not,** each with the first difference at the first native frame (`   0: std::panicking::begin_panic::<...>` against the port's `note: rust-ts prints the JS stack`):

- `tydump-ui`, `thirdump-ui`, and `thir-tree`, each: the `#old` revisions of `next-solver/cycles/use-impl-to-normalize-own-self-ty-ice.rs`, `next-solver/normalize/old-solver-caching-bug-151069.rs`, `next-solver/normalize/success-results-in-unconstrained-infer.rs`, `next-solver/overflow/incorrect-old-solver-caching-ice-148095.rs`, `projection-cache-rematch-impl-122529.rs`, `projection-cache-rematch-impl-141124.rs`. `thir-tree` also: `error-reporting/trait-bound-holds-for-ty-error-140303.rs#old`.
- `mirdump-ui`: `mir/lint/storage-return.rs`, `mir/validate/call-move-arg.rs`; UNPORTED `mir/lint/no-storage.rs` (`Backtrace Display (captured frames)`).
- `mir-o2`: `simd/intrinsic/inlining-issue67557-ice.rs`, `simd/shuffle.rs#noopt`, `simd/shuffle.rs#opt`.
- `miri-pass`: `tests/panic/mir-validation.rs`.

The `mir-o2` and `miri-pass` rows are outside the ICE report's 118: `mir-o2` is newer, and Miri's `mir-validation.rs` was not in its scope. `mir-o2` therefore compares 3,479 cases, not the 3,476 of `docs/reviews/integ-w39-recheck.md`, and 3 of them DIFF until native frames exist.

### Why no other case can change

A status can change only where a stderr holds a line the mask rewrites, so I scanned the oracle cache: all 371,901 cases of all 66 suites, by their keys.

| Scan | Result |
|---|---|
| Cases with no cached entry | 68: the 51 above, 14 `parse-ui-json`, 3 `parse` ORACLE_TIMEOUT. The 14 print no thread line and are the same in 3 runs each, and the 3 do not finish |
| Non-Miri cached entries with a thread line in stderr | **0** |
| Any cached entry with a long-type note | **0** |
| Miri cached entries with a thread line in stderr | 333, **0 of them an ICE**, so none is masked |
| Thread lines in stdout | 7 (`run-fail-miri`), never masked |

A subject-only thread line changes nothing either: the oracle has no such line to equal it, and a literal `<tid>` cannot equal a masked id.

### Oracle cache keys

**Masking changes no key and forces no re-run.** Dumped on `5eda654d` and on the head: of 371,901 cases, the only keys that change are `parse`'s 21,526, which is item 6. What does change is that the 50 entries that were never cached are now cached, so each runs its oracle once and no more, where before it ran at every gate.

### Is each oracle reproducible once masked?

Each of the 51, plus the 14 above, ran **3 times** on the head's mask. All 44 freed cases are equal once masked, and the 6 long-type cases under item 5's, including the two the handoff said to keep unless proven: **`proc_macro_generated_packed.rs` proves stable, so its entry goes, and so does Miri's `mir-validation.rs`** (also not in the handoff's list, whose reason was the same). `panic1.rs` stays listed: its digits are the interpreted program's real pid under isolation off, and the mask rightly leaves a non-ICE Miri stderr alone. That is the one list left.

### What stays different

`scripts/lib/unstable.test.ts`: the handoff's 6 negatives, unchanged, all different. Added:

- a stdout that prints the stderr marker cannot get its digits masked (the range starts at the **last** marker, which is always inside the real stderr; a stderr that prints the marker masks less, so it can only show a difference);
- not at line start (`LL | thread ...`), `(1 )`, `rtid` on one side only, `paniced`, no quotes, a name across lines, `-1`, `1.5`;
- a different number of panics; the exit code;
- a literal `<tid>` against digits, **which the handoff's pattern would have let through**. The mask now gives a literal one more `<`, so no text can equal a masked id;
- the subject's ICE does not turn the mask on for a Miri oracle's program panic.

Positives: digits, `rtid`, `<unnamed>`, an empty name, mid-stderr, first line, several occurrences.

**On real output.** A cached `do_not_const_check.rs` (two panics), planted, through `compared` and `classify`:

| Plant | Status |
|---|---|
| Other digits on both lines | MATCH |
| Thread name | DIFF |
| Location | DIFF |
| Payload | DIFF |
| Non-digit id | DIFF |
| Stdout byte | DIFF |
| A stderr line removed | DIFF |
| Exit code | DIFF |

**Split suites (F4):** masked in the run case and in the oracle's re-run, and `scripts/split-run.test.ts` pins that another id reproduces with no `ERROR:`, that a location still DIFFs, and that the entry is cached raw. No split suite has an ICE today.

**Where it applies:** `compared` wraps single-mode suites only. A batch suite's text is stdout. `classify` itself is unchanged. The first-difference lines read masked text and the diff files' bodies stay raw. `ctfe-sample` and `phase-diff` mask the same way, so they do not contradict difftest. I did not see `phase-diff` reach an ICE: the one case I tried stops earlier under its own argv.

**For M7:** a natively run program prints its own thread id, as `docs/reviews/plan-ice-report.md` F6 warned. This mask would hide it on a non-Miri suite. It needs a fresh look when `run-pass-native` lands.

## 2. `coverage.ts`

`--check` now fails, one `ERROR:` line each, on:

- **`rustc-const`:** line `<line>` does not hold `const <NAME>`, no such file, or malformed. It counts as no ported fn.
- **`rustc-call`:** outside a marked fn; a position where no call of that name starts in that fn's upstream body; a next line that does not call that name; keys of one kind that differ; or malformed. A literal against a struct says nothing (`select/mod.ts:228`, `assert(.., "msg")` for a bare `assert!`), so it is not compared.

All 19 anchors and 2 const markers pass, `markers ok`. `scripts/lib/marker-check.test.ts` has each stale kind fail. **Still invisible: an anchor on a sibling call of the same name where neither has a key** (review N3). The whole `--check` takes about 3 s.

**`--order`, report only:** **917 markers out of order of 24,848, 348 descents, in 189 file pairs** (rows in `$RUST_TS_DATA/coverage-order.txt`). "Out of order" is how many would have to move. PORTING section 8 allows some, so this is not a failure yet, and I did not read the rows to split allowed from not. Worst: `mir/visit.rs` 57, `ast/visit.rs` 43, `ty/context.rs` 31, `ty/sty.rs` 30 (30 descents). It agrees with `docs/reviews/mono-wire.md` W5's hand count: `rustc_monomorphize` none, `mono.rs` 1.

## 3. `gate.json` retry times

For each subject that timed out in the pool, `attempts` in the jsonl and `retryTimes` in `gate.json`: wall, user, sys, max RSS and how it ended, for the pool's attempt and the one alone, with the final status. A MATCH there is a case that matched only through the re-run. RSS is Bun's `resourceUsage` (`wait4`), the number `/usr/bin/time -l` prints, so no extra process.

`classify` does not read it, `scripts/retry-times.test.ts` runs a real `difftest` with stubs, and a case with no timeout keeps its exact row.

**Not recorded:** what else was running. Wall against CPU shows contention, but not whose. perf-near-limit's guess, several 10-16 GB cases overlapping, needs overlap data this does not give; I kept to what you asked.

## 4. `mir-heavy`

- **Unprotected in `mir`:** the id is not in `harness/baseline/mir.txt`, and the test checks it. It is in other suites' baselines, as different cases that stay protected and take under 0.2 s.
- **`mir` is one suite with no sibling, so this needs a new suite.** The rule is on the list, `MIR_HEAVY`. It has no baseline file, and `gate.ts run` defaults to suites with one, so it runs only with `--suites mir-heavy`.
- **Cost if run:** one oracle (59-68 s quiet; I measured 117 s wall, 102 s CPU, 8.9 GB at load 20, cached after that) plus the subject alone up to 30 min. It did not finish in 420 s at 16 GB per perf-near-limit, on a 24 GB host.
- **Case lists, base against head:** 371,901 each. `mir` loses this case, `mir-heavy` gains it, nothing else moves.

**Other cases on the oracle-cost rule.** I did not time all 371,901. I timed the 25 largest cached outputs of each non-Miri single-mode suite plus known slow files (836 runs, 100 s cap), and all of `mono-ui`, whose oracle does more than its subject (maximum 0.6 s). Miri's heavy lists come from `scripts/miri.ts time`.

| Case | Oracle | Status at the gate | Root's question |
|---|---|---|---|
| `parse`, `expanded`, `expanded-nocore`: `deep-try-chain-issue-153583.rs` | 148 s in `parse`, over 100 s in the others | **MATCH, protected** | Meets the rule, cannot move: cached, so no gate cost |
| `hir-tree`: `fn-to-method-deeply-nested.rs` | over 100 s | **MATCH, protected** | The same |
| `parse`: `issue-93775.rs`, `expr-stack-overflow.rs`, `survive-peano-lesson-queue.rs` | ORACLE_TIMEOUT, never cached | Unprotected | **These cost each gate up to 300 + 1,200 s per case.** `NOCORE_SKIPPED` already leaves them out of the other suites. I recommend the same for `parse`; I left it |

## 5. Long-type digits

Only the digits of `.long-type-<digits>.txt'` are masked, in every suite, stderr only. The stem (digits included, the mistake `docs/reviews/fixers-40.md` made in its own script), directory and text compare, and a note either side invents or drops differs. **What it gives up:** whether two notes name one file.

The six cases MATCH: `error-reporting/conditionally-implemented-trait-long-type.rs` and `on_unimplemented_long_types.rs` in `tydump-ui`, `thirdump-ui`, `thir-tree`. Those suites have no unstable list now. Only the file's *contents* stay uncompared, as `long_type.oracle.test.ts` covers them.

## 6. `parse`, `RUSTC_ICE=0`

| Measure | Result |
|---|---|
| Outputs with `RUSTC_ICE=0` against the entries cached without it | **21,523 of 21,523 byte-identical** |
| Full pass | 226 s at 12 jobs, 289 s at 8, at load 15-25; 148 s is one case |
| Disk | 457 MB more until the old entries are removed. Free: 16 GB. No tool removes them |
| Other `parse` keys | The 3 ORACLE_TIMEOUT were never cached |

**The change is made, as the cost is small.** "21.5k re-runs" sounded large, but `parse` barely does any work per case. Other options I weighed:

- **Subject-only env:** no re-run, but the only suite whose two sides differ in environment.
- **Guard:** already there. `upstreamChanges` reports the file and fails the gate, naming the path.

Other single-mode suites without it: `symbols` (no hook), and `check-rg*`, whose script sets it.

## 7. `plan-m7.md` and H9

Corrected: 3,479 for `mir-o2` and `mono-ui`, 36 reported cases of 34 crates for `check-rg`, O6 and "29 of 34" as the comparison's artifact (D13 drops O6, its row reads closed), and free disk. **Not changed:** `run-pass-native`'s "3,470 + heavy" (a different count, and right), and L4's other rows, which are `docs/next.md` and `PLAN.md`, root's.

**H9's count is wrong by 7. It is 60 of 406, not the 53 you quoted:** level 4 on 346, 3 on 2, 2 on 21, 1 on 8, 0 on 29. H9 missed the spelling `-Z mir-opt-level=N`. On the oracle the last flag wins across both spellings: a small program prints level 0's MIR for `-Zmir-opt-level=4 -Z mir-opt-level=0` and level 4's for the reverse. The description and `compiletest.ts:1273` say 60. A description is not in the oracle key.

## 8a. Mono sets

As `docs/handoff/mono-wire.md` lists them. `diagnostics.gen.ts` regenerates unchanged (16 derives), and 5 `stable_hash` impls generate with 0 missing. Beyond its three edits I removed the imports only the deleted code used.

**Load order, a statement prepended to each module, `--version`:**

| Entry | Base | Head | Difference |
|---|---|---|---|
| rustc | 2,059 | 2,060 | `mono_stable_hash.gen.ts` only, same order |
| Miri | 2,243 | 2,244 | The same |

`bun test src/rustc_monomorphize`, `stable_hash`, `attr_ir`: 135 pass, including the fingerprints against the probe. The review's 636-fingerprint and 423-of-423 comparisons were not re-run; the generator's input is what they checked.

## 8b. Long error descriptions

- **Output committed:** `src/rustc_errors/error_codes_text.gen.ts`, 518 texts, 418,411 bytes of text, 442,956 of module. ASCII only through `\u` escapes, no imports. `tools/codegen/error_codes.ts --check` fails on a stale file.
- **Kept out of startup:** a synchronous `require` in `ErrCodeDescription.text()`, as `rustc_monomorphize` does. `tools/codegen/error_codes.test.ts` fails on a static import anywhere in `src/`.
- **The test:** each text hashed as UTF-8 against its `.md` file's bytes, 518 of 518, including the 12 non-ASCII files, and 0.3 s of CPU.
- **Startup, hello:** 2,060 modules, none of them this one. Instructions, 6 alternating runs at load 20: base 10.04-10.47 G, head 9.70-9.95 G. **No increase.** I do not claim the decrease: this path gains nothing here, and the two trees differ in path. The `require` takes 2 ms when it happens.
- **Bundle:** `bun build --compile`, an E0308 under `--error-format=json`: stderr byte-identical to the oracle, with the explanation in it.
- **Moved:** the 7 `miri-fail` cases that stopped here MATCH: `const-ub-checks`, `erroneous_const`, `erroneous_const2`, `layout_cycle`, `miri_start_wrong_sig`, `rustc-error`, `rustc-error2`. The lane's "about 8" is 7 by my count: the stops at this message in `20261105-013348-root-1dzj`, the last full run without its prototype. Unprotected.
- **Beyond a generator:** you asked to lazy-load it, so I made the port side too, which the fixers-40 spec had left to a later lane: `codes.ts`, one comment in `json.ts`, and the 3 rows of `json.oracle.test.ts`, which now pass as plain comparisons. Please review that as port code.

**A measurement limit:** my load plugin's async `onLoad` breaks a synchronous `require`, so the plugin could not list the module on a run that reads a text. The `require` was checked through the real run and the bundle.

## Checks

| Check | Result |
|---|---|
| `bun test ./scripts ./harness`, `RUST_TS_REQUIRE_PROBES=1` | 329 pass, 0 fail, on the final code |
| `bun test ./tools` | 72 pass, 0 fail |
| `bunx tsc --noEmit -p .` | Clean |
| `coverage.ts --check --offline` | `markers ok` (24,848; vendor 5,086; library 595) |
| `json.oracle.test.ts`, `tests.test.ts` in `rustc_errors` | 107 pass, 0 fail |

**`--sample`, `RUST_TS_AGENT=harness-w40`, `--jobs 6`, load about 20:**

| Suite | Cases | MATCH | Other, none protected |
|---|---|---|---|
| `mir` | 200 | 200 | |
| `mir-o2` | 200 | 199 | DIFF `simd/shuffle.rs#opt`, in the table above |
| `tydump-ui` | 200 | 199 | DIFF `incorrect-old-solver-caching-ice-148095.rs#old`, in the table above |
| `thirdump-ui` | 200 | 199 | The same |
| `thir-tree` | 200 | 199 | The same |
| `mirdump-ui` | 200 | 200 | |
| `pm-ui` | 200 | 200 | |
| `miri-pass` | 200 | 197 | DIFF `tests/panic/mir-validation.rs`, in the table above; UNPORTED `shims/socket.rs`, `x86/intrinsics-x86-aes-vaes.rs` |
| `run-pass-miri` | 200 | 199 | UNPORTED `threads-sendsync/sync-send-in-std.rs` (sockets) |
| `borrowck-ui` | 200 | 200 | |
| `check-ui` | 200 | 200 | |
| `miri-fail` | 100 | 99 | UNPORTED `shims/return_type_mismatch.rs` (`open_file_or_dir`) |
| `parse`, an earlier run, `--sample 40` | 40 | 40 | |

No TIMEOUT, CRASH or ORACLE_TIMEOUT. No run reported a change to the upstream checkout, and it is clean.

**Unit time (F5's 5 s), CPU at load about 20:** `retry-times` 0.3 s, `error_codes` 0.3 s, `marker-check` 0.03 s, `lib/unstable` under 0.01 s, `split-run` + `unstable` 0.3 s more, `m7-suites` about 0.1 s more. **About 1 s in all.** The first `mir-heavy` test cost 2.3 s by walking `mir`'s corpus; I cut that (`b3ec954e`).

**Not run:** the gate and full suites. Item 1's result rests on the 51 cases run in full, the cache scan and the samples. Linux and Windows.

## For root

- **Decisions to record:** the status table above; `proc_macro_generated_packed.rs` and `mir-validation.rs` retired from the lists, the latter beyond the handoff's list; the literal-`<tid>` rule, stricter than the reviewed pattern; `parse`'s env.
- **Your call:** `parse`'s 3 ORACLE_TIMEOUT; whether `--order` becomes a check; a tool to remove orphaned oracle entries (the 457 MB).
- **Files I left stale:** `src/rust_ts/track_caller_check.ts:10` still says `coverage.ts --check` does not know these markers. Its own weaker check can go. `docs/next.md` is yours.
- **The gate:** after this lands, `parse`'s entries re-run once (about 5 min), and 50 others run once. 24 cases are new MATCHes for it to protect.
- **`README` and docs** that quote `mir` as 21,526 cases are 1 high now. I did not hunt them.
