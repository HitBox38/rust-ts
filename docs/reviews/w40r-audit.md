PASS WITH NOTES

**Wave 40r's accept stands.** No protected case was lost, removed or tampered with. All 67 suites ran: the 61 with a baseline, plus
the six M7b suites, under the recorded gate-scope decision (2026-11-14T16:27, "the six M7b suites"). I checked each of the 542,306
protected ids in the 61 `harness/baseline/*.txt` files at `241df65f` against this gate's jsonl. Every one is `MATCH`.

The accept commit (`4ec9a565`, parent `241df65f`) adds exactly six baselines and touches no other. Each one lists exactly its suite's
MATCH ids: `ir-run-pass` 3,369, `ir-run-pass-o0` 3,371, `ir-host` 3,282, `native-hello` 1, `run-pass-native` 3,277 and
`run-fail-native` 281. That is 13,581, which equals `gained`.

I compared every row of the 103 jsonl files this gate shares with wave 40q's, on every field. The ids and their order are the same in
every file, and so is every status count. **Only 15 rows moved, all in `attempts`/`retried`:**
- 13 are this gate's retries. Each was also retried in 40q, and each is MATCH in both gates.
- 2 were retried in 40q and not here.

**No stop reason (`unported`, `first`) moved.** The six new suites' oracle outputs are sound to protect, with one exception:
**`run-pass-native` `tests/ui/threads-sendsync/yield1.rs` is a race** (N2). Its source has the same shape as `yield.rs`, which is
listed as unstable for that reason.

**The battery spell touched no protected case** (N1). Battery ran from 22:57:54Z to 23:15:53Z (`pmset -g log`). That window lies
inside one case: `run-pass-miri-heavy`'s `hashset-connected-border-12860.rs`, which runs alone first in its suite, from 22:55:23Z
until its 1,800 s timeout at about 23:25:23Z. That case is TIMEOUT in every gate and is protected nowhere. The six new suites
finished at 22:36:46Z, 21 minutes before the spell.

**One reachability claim is wrong, harmlessly for now** (N3). The default-sysroot lane says "every protected suite passes
`--sysroot`" (`filesearch.ts`). `parse` (21,523 protected), `mir-core` and `check-core` do not pass it. So since this wave, every one
of those compiles spawns rustup's `rustc +nightly --print sysroot` while building its session. Without a `rustc` on `PATH`, the new
main.ts stops UNPORTED on a protected `parse` case where the old one passed (measured). In this gate the spawn worked everywhere and
every row is unchanged. The cost is the dependency, plus about one proxy spawn per case.

**Host:** this gate was slower than 40q, from load and memory pressure, not from the binaries (N4, N5):
- The 61 earlier suites took +11.5% in total.
- The heavy phase was +20–90% wall at load 4–10.
- The retries' alone times are within ±0.8 s of 40q's.
- An A/B of the old and new main.ts on a quiet machine gives equal time and output.

Regression audit, 2026-11-15. Gate `gate-20261114-162816-root-vc2v`, tested `241df65f`, accepted `4ec9a565`, `RUST_TS_SUBJECT=binary`,
Bun 1.4.4. Previous accept: wave 40q, gate `gate-20261114-065555-root-0e2v`, tested `ab0d5280`, accepted `0da8b38d`. I ran no gate,
no difftest and no full suite. What I ran:
- **Rows:** a comparison of every row of the 103 shared jsonl files with 40q's, on every field. I also checked every id of the 61
  baselines at `241df65f` (`git show`) against this gate's jsonl, and each of the six new baselines against its suite's MATCH rows.
- **Records:** `gate.json`, both `history.jsonl` entries, the gate log (`.data/tmp/gate-w58.log`, against 40q's `gate-w57.log`), the
  summaries (diffed with 40q's) and the three junit files.
- **Oracle cache:** every file written during the gate, found by mtime, classified by content and time. I then took the oracle cache
  keys of all 14,077 cases of the six new suites from difftest's own `caseOracleCacheKey`, in this tree. That let me read each
  protected case's cached oracle output and scan it for nondeterminism after the suite's masks.
- **Binaries:** both subject-bin keys, recomputed from a `git archive` of `241df65f`, and their inputs compared with 40q's builds.
- **Diffs:** `git diff ab0d5280 4ec9a565` over `harness/`, `scripts/` and `tools/`, and the changed sources that every compile runs
  (`rustc_session`, `rustc_driver_impl`, `link_binary`, `back/metadata.ts`).
- **Timing:** old against new binaries on `mir-alloc`'s compile (3 runs each, alternating, quiet host). I also ran a
  no-`rustc`-on-`PATH` run of both main.ts binaries on one protected `parse` case and one `expanded` case, and, by accident, on core's
  metadata compile (N5).
- **Criteria:** `bun scripts/criteria.ts --run gate-20261114-162816-root-vc2v --milestone M7`.

AC power throughout my work (`pmset -g batt`), and `RUSTUP_AUTO_INSTALL=0`. No gate was running (no `.data/tmp/GATE_RUNNING`). The host
was quiet (load 2–3) during the mir-alloc A/B and the no-`PATH` runs. Other sessions started difftests near the end (load 16–84),
which is why the core A/B was not repeated (N5). I changed no code.

## Notes

| # | severity | note | evidence |
|---|---|---|---|
| N1 | info | **No protected case ran on battery or near it.** **The window:** `pmset -g log` reads `Using Batt` from 22:57:54Z until `Using AC` at 23:15:53Z (18 min; local times 00:57:54 and 01:15:53). The gate's samples agree: AC at 22:55:23Z, battery at 22:58:18Z and 23:09:18Z (97%), AC at 23:16:18Z (92%). The gate printed its `power lost` and `power back` notes. **What ran then:** `run-pass-miri-heavy` started at 22:55:23Z. A heavy suite runs one process at a time (`jobs = 1`, `difftest.ts:1076`). The oracle was cached. Its 8 cases' wall times add up to 4,116.5 s against the suite's 4,117 s, so the first case, `hashset-connected-border-12860.rs`, ran from 22:55:23Z to about 23:25:23Z, when it timed out (exit 143 at 1,800 s). That covers the whole window. That case is TIMEOUT in 40q too, and protected in no suite. The next case, `dynamic-drop-async.rs` (protected), began after 23:25Z on AC. **The suites before:** `rmeta-std` ended at 22:55:23Z, its `hostEnd` reading AC. The six new suites ran from 21:44:46Z to 22:36:46Z, so no newly protected case is near the window. **Within the six:** no case was retried and no subject timed out (`retried` empty, `TIMEOUT` 0). No protected native oracle output contains `timed out after`. The only intermittent outcomes are the 25 listed UNSTABLE cases (N6). | `pmset -g log`; `host.samples`; gate log; `difftest.ts`; jsonl |
| N2 | **medium** | **`run-pass-native` `tests/ui/threads-sendsync/yield1.rs` is protected but racy, and should be listed in `NATIVE_UNSTABLE`.** Its `main` spawns `child`, prints `1`, calls `thread::yield_now()` and only then joins. `child` prints `2`. The oracle's runs printed `1\n2` each time: two in `oracle-self`, two in the cached `--runs 2`, and the subject's run printed it too. But nothing orders the two `println!`s. Under load, or with a different spawn latency in the port's binary, `2\n1` is a legal output, and it would be a false loss of a protected case. `yield.rs` has the same shape, prints from both threads around `yield_now`, and is already listed: `harness-m7b-recheck` note 6 accepted it as "a real race", though never reproduced. I scanned the protected native cases whose source uses threads, child processes, time or hash maps and whose program prints two or more lines: 48 of them. I read the thread ones. Each joins the thread before the other side prints, or prints from one thread only. The process, time and hash-map ones print fixed text. `yield2.rs`, `task-comm-12.rs` and `try-wait.rs` use `yield`/`sleep` but print nothing racy. **Recommendation:** list it with the `INTERLEAVING` reason, and decide how the ratchet treats a protected id that becomes UNSTABLE. | `tests/ui/threads-sendsync/yield1.rs`; cached oracle output; N6 |
| N3 | low | **The default sysroot is now read by protected compiles that pass no `--sysroot`, against the lane's own claim.** `filesearch.ts` `default_sysroot` says "Every protected suite passes `--sysroot`". The default-sysroot reviews proved the inverse: no spawn when `--sysroot` is passed (fake `rustc`, `default-sysroot.md` §"No spawn on a protected `--sysroot` compile"). The protected subjects that pass none are the 21,523 `parse` cases (`main.ts --edition=… -Zunpretty=ast-tree <file>`), `mir-core` and `check-core` (`CORE_ARGS` has no `--sysroot`). `check-rg*` pass it through `rg-rustc.ts`. The dump suites build no `Session`. There, `build_session` calls `sopts.sysroot.path()` (`session.ts:1398`), and `Sysroot.default_` spawns `rustc +nightly --print sysroot` with `oracle_sysroot_env()`. Upstream reads its own binary's location instead. **Measured** with `env -i HOME=$HOME PATH=/usr/bin:/bin`: on `parse` `tests/ui/entry-point/hello-world.rs`, old main.ts `c8a4e911` exits 0 and new `b7483c57` exits **70**, `rust-ts: unported: rustc_session::filesearch::default_sysroot (rustc +nightly --print sysroot failed: Executable not found in $PATH: "rustc")`. On the same file as an `expanded` case, with `--sysroot`, both exit 0. `check-core`'s compile behaves alike: without `PATH`, old completes and new exits 70 (N5). **In this gate the spawn worked:** all 21,525 rows are MATCH and unchanged. **The risk:** these protected cases now depend on rustup resolving `nightly` (today a link to `nightly-2026-10-11`) in the case's environment. A gate run with another `PATH`/`RUSTUP_HOME` would lose all of them at once. Also, `parse` took +42% (N4), the largest rise of any light suite that passes no `--sysroot`, which fits one proxy spawn per case under load. **Recommendation:** correct the comment, and either pass `--sysroot` in those suites (a harness batch) or record that they rely on the oracle toolchain being on `PATH`. | `filesearch.ts:166-211`; `config.ts:1707-1760`; `session.ts:1398-1444`; `harness/suites.ts` (`CORE_ARGS`, `parse`); measured |
| N4 | low | **The earlier suites took 11.5% longer, and the heavy phase 20–90% longer at low load. The binaries are not the cause.** Summed time of the 61 earlier suites: 21,178 → **23,619 s**. The six new ones took 3,120 s more (21:44:46Z–22:36:46Z). **Load** (1-min, 40q → 40r): median 54.0 → **82.5**, p90 129.4 → **150.1**, max 208.3 → **215.8** (20:25:17Z in `run-pass-miri`; 5-min 204.5, 15-min 170.4). Samples above 100: 24 → **49**; above 150: 6 → **18**. Swap: 6.0–7.4 GB → **4.8–8.0 GB**; it started at 8.0 GB and fell during `resdump` (19:18–20:11Z). **The brief's "195 and 5.2 GiB of 6" are other readings:** the gate's samples show the figures above, and `vm.swapusage` now shows 4.9 GB used of 6. The largest rises are at high load: `resdump(-nocore)` +33/35%, `hir-tree` +37%, `mir-o2` +32%, `parse` +42% (N3). **The heavy phase** ran at load 4–10, with wall and user time up (40q → 40r, wall / user s): `check-core` 116.5/148.3 → 156.2/172.0, `mir-core` 118.3/151.1 → 158.7/186.8, `rmeta-core` 92.8/140.1 → 160.1/182.0, `check-rg*` 57–79 → 109–115 s wall (user +77%), the alloc/std cases +20–28%, and Miri heavy +4% to +25%. Max RSS fell for the core cases (6,365 → 5,748 and 6,718 → 5,704 MB), which fits more collection under memory pressure. `pmset -g log` records no thermal or performance warning. **The binaries:** see N5. All are far under their limits (1,800 s, 12,288 MB); `heavyErrors` is empty. | `gate.json`; gate logs w57/w58; `pmset` |
| N5 | info | **Old and new binaries run at the same speed.** **Retries:** the 13 shared retries' alone times are within −0.3 to +0.8 s of 40q's (table §5), at a higher pool load. **A/B, quiet host (load 2–4), `mir-alloc`'s compile, 3 runs each, alternating:** old main.ts `c8a4e911` 20.2 / 42.7 s (median wall / user) against new `b7483c57` 19.5 / 42.2 s. stdout is identical (sha1 `ed14c1e1…`), exit 0. The gate took 22.8 / 46.7 s, and 40q's gate 18.2 / 41.2. **Core's metadata compile was not A/B'd.** My first attempt ran without `PATH`: I applied difftest's `caseEnv` delta to an empty base by mistake. In that environment the old main.ts compiled core (225 s wall / 188 s user, at load 16–37 from other sessions) and the new one stopped at once, exit 70, in `default_sysroot`. That is N3 again, this time for `check-core`. The mir-alloc A/B is unaffected: both binaries got the same environment, and mir-alloc passes `--sysroot`, so neither spawns. By then other sessions' difftests had the load at 84, so I did not repeat the core run. So the heavy phase's extra time came from the host, not the build. | `retryTimes`; `/usr/bin/time -l` |
| N6 | info | **The six new baselines are sound to protect, N2 aside.** **Counts:** every protected case of the six has a cached oracle entry under its `caseOracleCacheKey`. The only keys without one are the 25 UNSTABLE cases, which are never cached. The UNSTABLE rows are exactly `NATIVE_UNSTABLE`'s 18 + 7 ids, and none of them is in a baseline. **Masks:** only the approved ones are in force. On the native suites (`maskProgramOutput: true` on `nativeSuite` only), those are the line-anchored thread-id mask on stdout and stderr and libtest's `finished in <time>s`. `native-run.ts` cuts `stack backtrace:` blocks on both sides and sets `RUST_TEST_THREADS=1` for `--test` programs. The IR suites use the default stderr masks, and `ir-run.ts`/`ir-normal.ts` did not change since 40q. This matches root's decision of 2026-11-14T14:53 and `harness-m7b-recheck` §1. **Scan of all 3,559 protected native oracle outputs, after `maskProgramOutput`:** no `ThreadId(`, and no `thread '…' (<digits>)` left: the thread ids of the 64 + 273 cases that print one are all on lines the mask covers. No `finished in <digits>` (30 + 11 cases masked). No `timed out after`, no unstable mark, no `rustc<6 chars>` temp dir. `0x[0-9a-f]{6,}` hits once per suite, and both are constants: `const-rec-and-tup.rs` prints `0xf0f0f0f0f0f0f0f0`, and `test-should-panic-failed-show-span.rs` prints a `TypeId(0xa770…)`, which the compiler derives from the type. The other long numbers are program constants. The case directory, `…/native/run-pass-native/<hash>/work` (`command-current-dir.rs`, `match-string-slice.rs`), is one fixed path per case that both sides use. **Oracle shape:** `run-pass-native` has 3,276 programs that ran with verdict `met`, plus 1 compile error. `run-fail-native` has 281 `met`: 173 exits, 108 signals. `native-hello` ran. For the IR suites, every protected entry is an `ir: <file> N1` text, except `layout/randomize.rs#randomize-layout` in all four of the host and IR suites, and `consts/const-int-arithmetic-overflow.rs` at `-O0`. Those two are E0080 compile errors from the oracle. `-Zrandomize-layout` is seeded from the type, not the clock, so they are deterministic. **What I could not check:** the run data keeps no output for a MATCH row, so I could not compare subject and oracle text for a sample. I would have to re-run the subject, which is a difftest. The verdict rests on difftest's `compared` with the masks above. | oracle cache; `NATIVE_UNSTABLE`; `unstable.ts`; `native-run.ts` |
| N7 | info | **The 61 earlier suites' definitions are unchanged, by this gate's own evidence.** Same case ids, in the same order, in all 103 shared files, the `.skipped` and `.extra` files included. The summaries are identical except `mir`'s `processes` 21,531 → 21,529 and `subjectTimeoutRetries.finished` 6 → 4 (the two fewer retries). **No earlier suite wrote an oracle cache entry:** the 13,419 entries written during the gate all fall between 21:44:47Z and 22:36:44Z, the six new suites' window. By content they are 9,885 IR texts, 3,529 native-run texts and 5 compile-failure texts. So every earlier case hit the cache, and its key was unchanged: pin, oracle version, suite, id, args, file hash, env, deps, inputDirs, split key, `oracleKey`. Subject commands are not in the run data; the harness-m7b reviews dumped them (75 of 75 identical). **`mono-ui`:** all 3,479 rows are identical to 40q's, field for field. `mono-run.ts` changed only by adding `join_codegen` and the three statistics overrides, which throw `Unported` and are never reached, plus comments. | jsonl; summaries; oracle-cache mtimes |
| N8 | info | **No earlier protected case reaches the native link path or the changed link code.** `link_binary` is byte-identical between `ab0d5280` and `241df65f`. The ssa-link-b additions (`exec_linker`, `link_natively`, `add_lld_args`, `raw_dylib`, `rpath`, the object writers) sit behind its `should_link()` branches. `back/metadata.ts` changed only in `create_compressed_metadata_file`, a codegen-time writer that was `unported` before. The loader is unchanged. The per-suite argv analysis of 40q's N6 still holds, as the suites are unchanged (N7). The only readers of the explicit-sysroot path's default are `all_paths()` callers: `get_linker`, `add_lld_args` and `strip_with_external_utility`, all link-time. So a `--sysroot` compile reads the default only when it links: the native suites, by design. The reviews' fake-`rustc` check covers this. | `git diff`; `git grep` at `241df65f` |
| N9 | info | **The retries are 13, against 40q's 15. None is above 45 s alone.** `mir` has 4: `infinite_loop.rs` and `projection-cache-rematch-impl-141124.rs` were not retried this time. `run-pass-miri` has the same 9 as 40q. Largest alone: `dynamic-drop.rs` 39.2 s (40q 39.0), `issue-8827.rs` 38.4 s (37.6). Every alone run finished. Pool load at the timeouts was 170–239 (40q 114–251). | `retryTimes` |
| N10 | low | **Side effects of this audit on the main checkout's `.data`, all reverted or benign.** **(a)** My first command-dump script ran in `RUST_TS_SUBJECT=binary`, which builds a missing binary: it built `subject-bin/09e8018d…` (keyed on my worktree's paths) at 00:08:30Z. I confirmed `meta.json`'s `repo` was my worktree and deleted the directory. The four gate builds are untouched. **(b)** Importing `harness/suites.ts` calls `crateSrc` (`harness/library.ts`), which re-ran `cargo fetch` into 14 existing `.data/crate-fetch/<crate>` directories. That rewrote their `Cargo.toml`, `lib.rs` and `Cargo.lock`, as every gate's import does. **(c)** Taking `cases()` touched only directory mtimes under `.data/aux` (no file changed). **(d)** `.data/tmp`'s mtime changed. Worth knowing: `RUST_TS_SUBJECT=binary` with a harness import writes to `subject-bin`, so read-only audits should leave it unset. | `ls`, `stat`, `find -newer` |

## 1. Protected set: nothing lost

| Check | Result |
|---|---|
| Baselines `ab0d5280` → `241df65f` | Only `ir-hello.txt` was added (40q's accept, `0da8b38d`). `git diff --stat 0da8b38d 241df65f -- harness/baseline` is empty. 61 files |
| Protected ids (`241df65f`) against this gate's jsonl | **542,306, every one `MATCH`**, no duplicate ids. Each suite's `gate.json` `baseline` equals its file's line count |
| `gate.json` | `pass: true`, `staticOk`, `skipStatic: false`, `head` `241df65f`, `dirty: []`, `unstableOk`, `upstreamOk`, `staticNotes: []`. 67 suites: 40q's 61, with `ir-hello` now in the alphabetical baseline group, then the six new ones before the heavy suites. Sums: `lost` 0, `gained` 13,581 (the six only), `lostSkipped` 0, `oracleTimeouts` 0, `upstreamChanges` 0, batch-only failures and timeouts 0, `retried` 13, `unstable` 26 (1 + 18 + 7), `heavyErrors` 0. Baseline 542,306, match 555,887, total 556,722. `host.powerLost` has one entry, 22:58:18Z at 100% (N1) |
| Gate log (`gate-w58.log`) | 61 `ok … lost=0 gained=0` lines. Six `ok … protected=0 … gained=<n>` lines. IR tier N1 notes for the three IR suites. Unstable notes for `miri-pass` (1), `run-pass-native` (18) and `run-fail-native` (7). The power lost/back notes, then `gate PASS run=gate-20261114-162816-root-vc2v`. No `ERROR` |
| `history.jsonl` accept entry (2026-11-15T00:04:34Z) | `runId` and `head` match. 67 suites. Each `protected` equals its baseline's line count at `4ec9a565` (0 mismatches, sum 555,887). The three IR suites carry `irTier: "N1"` |
| `4ec9a565` | Parent `241df65f`. Changes `README.md`, `docs/next.md`, `docs/state/current.json` and `docs/state/history.jsonl` (+1), and **adds the six baselines**, each exactly that suite's MATCH set (sorted ids equal) |
| Gate scope | Decision 2026-11-14T16:27: "the six M7b suites … join the gate's --suites" |

**New suites' rows:**

| Suite | MATCH (protected) | UNPORTED | DIFF | UNSTABLE |
|---|---:|---:|---:|---:|
| `ir-run-pass` | 3,369 | 101 | 9 | 0 |
| `ir-run-pass-o0` | 3,371 | 104 | 4 | 0 |
| `ir-host` | 3,282 | 124 | 9 | 0 |
| `native-hello` | 1 | 0 | 0 | 0 |
| `run-pass-native` | 3,277 | 119 | 0 | 18 |
| `run-fail-native` | 281 | 1 | 0 | 7 |

**Every row against 40q.** The same 103 files, with the same ids in the same order. Status counts are equal: MATCH 542,306, UNPORTED
308, DIFF 28, TIMEOUT 2, UNSTABLE 1, and 4,317 skipped/extra rows. Every field is equal, except:

| Suite | Rows | Change |
|---|---|---|
| `mir` | 6 | `attempts` (4 retried in both gates), and `retried`/`attempts` dropped on `infinite_loop.rs` and `projection-cache-rematch-impl-141124.rs` (not retried this time) |
| `run-pass-miri` | 9 | `attempts` only (the same 9 retries) |

Every moved row is MATCH in both gates.

**`git diff --stat ab0d5280 4ec9a565 -- harness/ scripts/ tools/`:**

| File | Change | Effect on protected suites |
|---|---|---|
| `harness/baseline/ir-hello.txt` | new, 2 ids (40q's accept, `0da8b38d`) | Protected since 40q |
| `harness/baseline/{ir-run-pass,ir-run-pass-o0,ir-host,native-hello,run-pass-native,run-fail-native}.txt` | new (this accept) | The protected set grows by 13,581 |
| `harness/suites.ts` | +the six suites: `nativeSuite`, `nativeCmd`, `NATIVE_UNSTABLE`, `NATIVE_HARNESS_SKIPS`, libc skips, `hostRunCorpus`, `irHostCorpus`. `irSuite` gains an optional `skipped` | None: the only removed lines are an import list and `irSuite`'s signature. Keys and ids are unchanged (N7) |
| `harness/compiletest.ts` | `RunProps` gains `errorPatterns`, `regexErrorPatterns`, `checkStdout` and `shouldFail`. Adds `withCompiletestTarget`, which restores the default target's memos | Read by the native suites only. The default-target memos are put back afterwards (a test pins that), so other case sets are unchanged (N7) |
| `harness/llvm-manifest.json` | +2 pins: `IntrinsicsX86.td`, `ModRef.h` | None: coverage and llvm-src tooling only |
| `harness/m7-suites.test.ts` | tests | None |
| `scripts/native-run.ts`, `native-run.test.ts` | new: the native suites' wrapper | Native suites only |
| `scripts/oracle-self.ts` | new: oracle-against-oracle stability check | Not run by the gate; never touches the cache |
| `scripts/lib/unstable.ts`, `unstable.test.ts` | +`maskLibtestTime`, `maskProgramOutput`. `maskedTexts` takes an optional extra mask. +an `UNSTABLE_ORACLE_PATTERNS` entry, `^native-run: unstable: ` | With no extra mask, `maskedTexts` gives the same text (recheck §1). Only native-run prints the new pattern |
| `scripts/difftest.ts` | `compared` passes `maskProgramOutput` when `Suite.maskProgramOutput` is set. Header text | Set on the native suites only |
| `scripts/gate.ts` | `oracleRuns` knows `NATIVE_RUN` (the oracle's compiler) | Probe check only |
| `scripts/criteria.ts`, `criteria.test.ts` | `excludeUnstable` groups; the M7b/M7c groups | Reporting. `mir-o2`/`mono-ui` have 0 unstable, so the same figures |
| `scripts/mono-run.ts`, `mono-run.test.ts` | `join_codegen`, `print_pass_timings`, `print_statistics` and `print_statistics_json` overridden to throw `Unported`. Comments | `mono-ui` rows identical (N7) |

`tools/`, `UPSTREAM.json`, `harness/corpus/`, the config files and the runtime C files did not change.

## 2. Static steps

From the gate log: `note: subject binary (src/rust_ts/main.ts b7483c57…, src/miri/bin/miri.ts 0b66f71a…)`, then `ok` for typecheck,
unit tests, unit test skips (1, allowlisted), unit tests (alone, 0 skips), runner unit tests (0 skips), markers, marker order, info sites
and frozen lists. `gate.json`: `unitTestSkips {skipped: 1, allowed: 1, unexpected: []}`.

Junit, 40q → 40r:
- unit tests 7,949 → **7,985 tests, 1 skipped, 0 failures (7,984 pass)**;
- unit tests (alone) 39 → **39**;
- runner unit tests 561 → **575**, 0 failures.

That is the pre-gate step's 7,984 + 39 + 575.

## 3. Bun records

| Check | Result |
|---|---|
| `gate.json` `bun` | `1.4.4`, `38afee6c84fcf48c0edb2466aa4b27d287a59c30`, unchanged |
| `bunExec.start` / `.end` | both `.data/gate-bun/run-74939-qA5pEz/bun`, sha1 `7c1f29cd…`, `1.4.4`; `goodAt` 00:04:00.259Z |
| `bunClone` | same path, `from` `~/.bun/bin/bun`, `how: clonefile`, `parent` 74939 |
| Builds' `meta.json` | both Bun 1.4.4, sha1 `7c1f29cd…`; main.ts `builtAt` 16:28:21Z (by this gate, started 16:28:16Z) |

## 4. Subject binaries and reachability

| Entry | Recomputed at `241df65f` | `gate.json` | inputs (40q) | added / removed / changed |
|---|---|---|---|---|
| `src/rust_ts/main.ts` | `b7483c57da464225a698941a79214d35c10ba472` | equal | 2,208 (2,203) | 5 / 0 / 30 |
| `src/miri/bin/miri.ts` | `0b66f71a6f6de0638dc8a62c3295cae263dfc5b3` | equal | 2,394 (2,389) | 5 / 0 / 30 |

**How:** `buildSpec`/`subjectBinKey` from the archive, then `subjectBinKeyOf(meta.spec, …)`. Inputs, config and runtime C equal
each build's `meta.json`, and config and runtime C equal 40q's too. The archive's spec, rebased onto the gate's repo path, differs
from `meta.spec` only in `bunPath` and the banner's `argv[0]`: the gate's private Bun clone, which the key replaces with a placeholder.

**Added:** `rust_ts/llvm/intrinsics_x86.ts`, `rust_ts/oracle_sysroot_env.ts`, `rustc_codegen_ssa/back/link/raw_dylib.ts`,
`back/rpath.ts` and `vendor/pathdiff/lib.ts`.

**Changed:**
- 9 `rust_ts/llvm/*` and 3 `rustc_codegen_llvm/*`, inside the lazy `ported_backend` require (40q N7);
- `codegen_backend.ts` (a comment);
- `back/{apple,command,link,linker,metadata}.ts` (N8);
- 8 `vendor/object` files (writers, constants);
- `rustc_session/{config,filesearch,session,stand_ins}.ts` and `rustc_driver_impl/lib.ts`, the default-sysroot lane. These run on
  every compile: N3 for compiles without `--sysroot`, N8 for compiles with it.

| Protected subject | `--sysroot` | Default sysroot read? |
|---|---|---|
| `parse` (main.ts, `-Zunpretty=ast-tree`) | **no** | **yes, at `build_session` (N3)** |
| `mir-core`, `check-core` (`CORE_ARGS`) | **no** | **yes (N3)** |
| every other main.ts suite, `check-rg*` (via `rg-rustc.ts`), `mono-ui`, the Miri suites | yes | only by a link (N8), which none reaches |
| lex, escape\*, tokens\*, symbols, fluent-\*, emit (dump entries) | n/a | no `Session` |
| native suites | yes | yes, for the linker's `PATH` (by design) |

**Startup:** the check-only suites took longer at similar or lower start load: `check-ui` 29 → 33 s, `rmeta-ui` 30 → 35 s, `parse-ui`
14 → 18 s, `pm-ui` 14 → 15 s, but `check-ui-encode-mir` 8 → 7 s. That is within the general +11.5% (N4). `mir-alloc`'s A/B shows the
same compile time old and new (N5).

## 5. Margins

**Solo retries** (alone wall / user s, 40q → 40r):

| Case | wave 40q | wave 40r | Δ wall |
|---|---|---|---|
| `dynamic-drop.rs` | 39.0 / 47.8 | **39.2 / 48.1** | +0.2 |
| `issue-8827.rs` | 37.6 / 45.1 | 38.4 / 46.1 | +0.8 |
| `error-tainting-issue-122904.rs` | 28.2 / 32.5 | 28.4 / 32.6 | +0.2 |
| `recursive-drop-elaboration-2.rs` | 28.1 / 32.4 | 28.1 / 32.4 | 0.0 |
| `recursive-drop-elaboration.rs` | 28.0 / 32.3 | 27.8 / 32.4 | −0.2 |
| `move-3-unique.rs` | 26.0 / 31.1 | 26.5 / 31.7 | +0.5 |
| `issue-52475.rs` | 20.0 / 20.8 | 20.4 / 21.2 | +0.4 |
| `repeated-vector-syntax.rs` | 19.6 / 25.4 | 20.2 / 26.0 | +0.6 |
| `recursion-etc.rs` | 16.4 / 18.4 | 16.6 / 18.8 | +0.2 |
| `unique-send-2.rs` | 15.9 / 22.3 | 16.1 / 22.5 | +0.2 |
| `macro-comma-support-rpass.rs#std` | 15.1 / 23.9 | 14.8 / 23.7 | −0.3 |
| `let-else-drop-order.rs` | 13.3 / 20.3 | 13.4 / 20.4 | +0.1 |
| `macro-comma-support-rpass.rs#core` | 12.3 / 20.7 | 12.4 / 20.7 | +0.1 |
| `infinite_loop.rs` | 15.2 / 15.8 | not retried | |
| `projection-cache-rematch-impl-141124.rs` | 14.0 / 18.5 | not retried | |

No case is above 45 s alone. The largest leaves 20.8 s of the 60 s limit.

**Heavy cases** (wall / user s, 40q → 40r; N4):

| Case | wave 40q | wave 40r |
|---|---|---|
| check-core | 116.5 / 148.3 | 156.2 / 172.0 |
| mir-core | 118.3 / 151.1 | 158.7 / 186.8 |
| rmeta-core | 92.8 / 140.1 | 160.1 / 182.0 |
| check-rg-encode-mir | 78.7 / 471.3 | 114.6 / 644.2 |
| check-rg | 58.3 / 363.4 | 109.8 / 633.1 |
| check-rg-host | 57.2 / 353.5 | 109.4 / 604.7 |
| check/mir/rmeta-alloc, -std | 17.1–19.9 | 17.3–24.8 |
| miri-pass-heavy | e.g. `consistency_sc.rs` 41.5 | 53.7 |
| run-pass-miri-heavy | e.g. `task-comm-6.rs` 157.5, `dynamic-drop-async.rs` 76.3 | 159.4, 92.7 |

Max RSS is at most 5,857 MB (`check-core`) against the 12,288 MB budget. The two `run-pass-miri-heavy` timeouts are as in 40q: 1,800 s
at 1,808.3 and 1,829.2 s user.

## 6. Power and host

| Check | Result |
|---|---|
| `host.powerLost` | `[{at: 22:58:18.829Z, percent: 100}]`; `allowBattery: false` |
| Battery window | `pmset -g log` 22:57:54Z → 23:15:53Z (18 min). Samples: AC 22:55:23Z, battery 22:58:18Z (100%) and 23:09:18Z (97%), AC 23:16:18Z (92%). All within `hashset-connected-border-12860.rs`'s run (N1) |
| Samples | 164 (16:28:16Z → 00:04:00Z). All AC except the two above |
| Load (1-min), 40q → 40r | median 54.0 → **82.5**, p90 129.4 → **150.1**, max 208.3 → **215.8** (20:25:17Z); above 100: 24 → **49**; above 150: 6 → **18** |
| Load (15-min) | max 147.1 → **170.4** (20:25:17Z, `run-pass-miri`) |
| Swap | 6.0–7.4 → **4.8–8.0 GB** (8.0 at the start, falling during `resdump`) |
| Suite time (61 earlier) | 21,178 → 23,619 s (+11.5%); the six new: 3,120 s |

## 7. Unstable and unprotected

- **Unstable, earlier suites:** `miri-pass` `tests/panic/panic1.rs`, as before.
- **Unstable, new suites:** `run-pass-native` 18 and `run-fail-native` 7, exactly `NATIVE_UNSTABLE`'s ids, none protected (N6). Add
  `yield1.rs` (N2).
- **Unprotected timeouts:** `run-pass-miri-heavy`'s `hashset-connected-border-12860.rs` and `step_overflowing.rs`, as in 40q.
- **Other unprotected rows of the earlier suites** (UNPORTED 308, DIFF 28) are row for row identical to 40q's, their `unported` and
  `first` fields included.

## 8. Criteria

`bun scripts/criteria.ts --run gate-20261114-162816-root-vc2v --milestone M7` (exit 1: M7 as a whole is not met, as
`harness-m7b-recheck` note 1 explains):

```
plan-m7 M7a ir-hello: MATCH 2/2 = 100% vs >= 100%, 0 oracle timeouts counted: met
plan-m7 M7a mir-o2: MATCH 3475/3479 = 99.89% vs >= 99%, 0 oracle timeouts excluded, 0 unstable excluded: met
plan-m7 M7a mono-ui: MATCH 3475/3479 = 99.89% vs >= 99%, 0 oracle timeouts excluded, 0 unstable excluded: met
plan-m7 M7a check-rg: MATCH 34 of 34 crates vs >= 33, 0 oracle timeouts: met
plan-m7 M7b native-hello: MATCH 1/1 = 100% vs >= 100%, 0 oracle timeouts counted: met
plan-m7 M7b run-pass-native: MATCH 3277/3396 = 96.5% vs >= 80%, 0 oracle timeouts excluded, 18 unstable excluded: met
plan-m7 M7b ir-run-pass: MATCH 3369/3479 = 96.84% vs >= 70%, 0 oracle timeouts excluded, 0 unstable excluded: met
plan-m7 M7c run-pass-native: MATCH 3277/3396 = 96.5% vs >= 98%, 0 oracle timeouts excluded, 18 unstable excluded: not met
plan-m7 M7c run-fail-native: MATCH 281/282 = 99.65% vs >= 95%, 0 oracle timeouts excluded, 7 unstable excluded: met
plan-m7 M7c ir-run-pass: MATCH 3369/3479 = 96.84% vs >= 95%, 0 oracle timeouts excluded, 0 unstable excluded: met
```

**M7b is met as recorded** (history 2026-11-15T00:05). If `yield1.rs` is listed (N2), `run-pass-native` becomes 3,276/3,395 = 96.49%,
still met for M7b.

## 9. Suites not run (report-only)

`harness/suites.ts` at `241df65f` registers 81 suites. 67 ran. The other 14 are 40q's list: `check-chain`, `check-core-bin`, `cli`,
`host-rlib`, `mir-heavy`, `miri-fail`, `miri-pass-tb`, `miri-sysroot-alloc`, `miri-sysroot-core`, `miri-sysroot-std`, `parse-ui-json`,
`rlib-native`, `stats-ui` and `target-specs`.

## What I did not check

- **Subject outputs of MATCH rows.** The run data keeps none, and re-running the subject would be a difftest. N6 covers the oracle
  side of every protected case of the six, and the masks.
- **Protected cases beyond the gate's jsonl.** I re-ran no case.
- **The lanes' code**: the fidelity of the link, raw-dylib, rpath, object-writer and IR changes. That belongs to their reviews. I
  checked reachability, not correctness.
- **Subject commands of the earlier suites.** They are not in the run data. I rely on the harness-m7b reviews' full dump, plus the
  unchanged oracle keys and rows (N7).
- **The cause of the host slowdown** (N4). The timings rule out the binaries; memory pressure is a likely explanation that I did not
  test.
- **Program run times of the native cases**, against native-run's 30 s per-run limit. They are not recorded. No protected oracle
  output shows a timeout, and no subject process timed out.

## Side effects outside my scratchpad

See N10. Beyond it:
- I copied `.env.local` into this worktree from `.data/integ-w39/.env.local`, and `bun install --frozen-lockfile` linked
  `node_modules`. Both are gitignored.
- I ran the existing builds `c8a4e911` and `b7483c57` for timing. They wrote to stdout and to an `-o` file in my scratchpad only.
  `git status` of the upstream checkout stayed clean.
- The key recomputation ran `Bun.build` in memory over a `git archive` tree in my scratchpad.
- This file is the only tracked change.
