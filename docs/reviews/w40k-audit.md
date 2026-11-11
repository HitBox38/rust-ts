PASS WITH NOTES

**Wave 40k's accept stands.** No protected case was lost, removed or tampered with. All 60 protected suites ran. Every one of the
542,304 protected ids in `harness/baseline/*.txt` at `9a03f050` is still in the baselines at `95ba28aa` and is `MATCH` in this gate's jsonl.
The baselines did not change (`9a03f050..95ba28aa`: 0 lines). I compared every row of all 102 jsonl files (the 60 suites plus their
`.skipped`/`.extra` files) with wave 40j's gate, on every field. The ids and their order are the same in every file. **Only 16 rows moved,
all in `attempts`/`retried`:** the same 15 retried cases as wave 40j, plus `nested_panic_caught.rs`, which was retried in 40j and was not this
time. Status counts are unchanged: MATCH 542,304, UNPORTED 308, DIFF 28, TIMEOUT 2, UNSTABLE 1.

**No expectation tampering, and Bun moved exactly the expected keys.** I dumped the oracle key of every registered case (374,690) from
`git archive` trees: `103b447a` on Bun 1.4.3, `ab750e50` on 1.4.4, and `ab750e50` on 1.4.3. **`ab750e50`@1.4.3 is byte-identical to
`103b447a`@1.4.3**, so the merged harness changes moved no key by themselves. 1.4.3 → 1.4.4 moves **exactly 2,307 keys in the 20 Bun-oracle
suites**, with nothing gone, added or changed anywhere else. My `ab750e50`@1.4.4 dump has sha1 `a3e1b6e58756…`, the same as w40j-audit's
`103b447a`@1.4.4 dump. Every one of the 111 non-doc files changed in the wave equals a reviewed lane head's blob, root's checked `4ce97419`,
or a clean merge of two reviewed lanes.

**The Bun records are sound.** `gate.json` records `bun` = `GATE_BUN` (1.4.4 `38afee6c84fc…`). `bunExec` start = end, both of the clone
(sha1 `7c1f29cd…`, 1.4.4, `38afee6c8`). `bunClone` is `clonefile` from `~/.bun/bin/bun`, which has the same sha1. The clone's directory is
gone: `$RUST_TS_DATA/gate-bun/` is empty, last changed 20:43:33Z, which is `bunExec.goodAt`. Both builds' `meta.json` name the clone as
`bunPath`, with its `bun` sha1. **Both build keys recompute at `ab750e50` to `gate.json`'s:** `49a56593…` (2,111 inputs) and `45bb8067…`
(2,299 inputs). `inputs`, `config`, `runtimeC` and `spec` are identical to `meta.json`.

**The re-run oracles are 1.4.4 output, but most of them were not written in this gate (N1).** All 2,021 moved keys of the 13 gated
Bun-oracle suites have a cache entry under their 1.4.4 key. Each one's text and exit code are **byte-identical to the entry under its 1.4.3
key**. Only 651 were written inside the gate, each inside its own suite's window. The other 1,370 are cache hits on entries written
10:56–12:52Z by the bun-144, stats and driver-cli-2 lanes and their reviewers' difftest runs. Those runs used the same Bun content, and the
key covers it. The 287 moved keys of the 7 suites outside the gate have no 1.4.4 entry yet. `docs/next.md`'s "the 2,307 Bun-dependent
oracles re-ran on 1.4.4" overstates what happened, but the result does not depend on it.

Regression audit, 2026-11-11. Gate `gate-20261111-141426-root-vl2w`, tested `ab750e50`, accepted `95ba28aa`, `RUST_TS_SUBJECT=binary`, the
first gate on Bun 1.4.4. The previous accept is wave 40j: gate `gate-20261111-034856-root-qgwe`, tested `103b447a`, accepted `9a03f050`. I ran
no gate and no full suite. What I ran:
- a comparison of every row of all 102 jsonl files of this gate against wave 40j's, on every field. I checked every id of the 60 baselines at
  `9a03f050` (`git show`) against the baselines at `95ba28aa` and this gate's jsonl. I also checked `gate.json`, the `history.jsonl` accept
  entry, the three junit reports, the frozen-lists run and the gate log (`.data/tmp/gate-w51.log`);
- `scripts/oracle-keys.ts` over every registered case, in `git archive` trees of `103b447a` and `ab750e50`, each with this worktree's
  `.env.local` and `node_modules`. The 1.4.3 runs used `$RUST_TS_DATA/bun-1.4.3/extract/bun-darwin-aarch64/bun` (`1.4.3+c6da4a4d3`, sha1
  `869d5d72…`); the 1.4.4 run used `~/.bun/bin/bun`;
- a per-file blob check of the 111 changed non-doc files against the six lane heads and root's `4ce97419`, with `git merge-file` for the one
  file two lanes changed;
- both subject-bin keys, recomputed in the `ab750e50` archive tree with that tree's `buildSpec`, `subjectBinKey` and `subjectBinKeyOf`. The
  spec was rebased onto the gate's repo path with `meta.spec.bunPath`, and Bun was taken from `meta.bun`;
- a decode of the oracle cache entry under both keys of every moved key in the gated suites, with write times, plus the 5+5 spot-checks (§4);
- `gate.json` `retryTimes`, `host.samples`, per-suite times and the heavy suite's per-case usage, against wave 40j;
- `bun scripts/coverage.ts` (summary, `--crate llvm-wrapper`, `--check`) and `bun scripts/criteria.ts --run gate-20261111-141426-root-vl2w`.

Everything ran on AC power (`pmset -g batt`), with `RUSTUP_AUTO_INSTALL=0`, `RUST_TS_REQUIRE_PROBES=1`, `RUSTC_ICE=0` and
`RUST_TS_AGENT=w40k-audit`. No gate was running (`.data/tmp/GATE_RUNNING` absent), and the host was quiet (1-minute load 2-3). I read code but
changed none.

## Notes

| # | severity | note | evidence |
|---|---|---|---|
| N1 | low | **Most of the "re-run" Bun-dependent oracles were not run by this gate.** Of the 2,307 moved keys: (a) **651 were written during the gate**, each inside its suite's window: check-ui 142/730, rmeta-ui 147/730, mir-opt-o4 256/406, check-ui-encode-mir 106/146. (b) **1,370 were cache hits** on entries written 10:56:59–12:51:58Z by lane and review difftest runs that afternoon: bun-144 (sample runs `…-110818`…`…-111011`, and the N4 runs `…-124323`…`…-125508`, which wrote all 9 single-case entries: check-{core,alloc,std,rg,rg-encode-mir,rg-host}, rmeta-{core,alloc,std}), stats (`stats-check-ui`, `stats-rmeta-ui`, `review-stats-*`), driver-cli-2 and `rev-dcli2-*` (200-case samples), and `review-bun-144-0sj4` (check-ui-encode-mir 40). (c) **287 have no 1.4.4 entry at all**: host-rlib 222, rlib-native 58, ir-hello 2, check-chain 1, miri-sysroot-{core,alloc,std} 3. These suites are not in the gate, and they will run on first use. **This does not weaken the result.** The key is `[PIN, sha1(Bun file content), suite, id, args, file hash, …, oracleKey]`, and `oracleKey` hashes the wrapper (`rmeta-run.ts`, `mir-dump-run.ts`, which import only node built-ins), the rustc driver and the probe. So a hit was produced by the same Bun build, wrapper, driver and input. `~/.bun/bin` has not changed since 09:59:49Z, an hour before the earliest such entry. **Every one of the 2,021 1.4.4 entries in the gated suites has the same text and exit code as its 1.4.3 entry.** But `docs/next.md` ("the 2,307 Bun-dependent oracles re-ran on 1.4.4") and the brief ("write times inside the gate") describe a fresh re-run that did not happen for 59% of the gated keys. Suggest rewording to "651 oracles ran in the gate, 1,370 were 1.4.4 entries from lane runs, and 287 are in suites not gated". If a policy wants every oracle of a Bun move produced by the gate itself, it needs a cache rule, which the harness does not have today. | `cache.ts`/`spot.ts` census (§4); run dirs under `.data/runs` with those suites' summaries; `harness/suites.ts:1307` `rmetaOracleKey`, `:2242`; `scripts/difftest.ts:277,384`; `stat ~/.bun/bin` |
| N2 | info | **w40j-audit N1's "2,308 keys" is a miscount.** Its own per-suite list sums to 2,307 (730+730+406+222+146+58+2 + 13 single cases), which is what moved. | §3 |
| N3 | low | **The host was busier than in wave 40j, and no result changed.** 1-minute load: median 53 (40j: 40), peak 273 (152), 36 samples above 100 (8), and 3 above 200: 251 at the end of run-pass-aux-miri and the start of run-pass-miri (17:43Z), and 273 during run-pass-miri (17:53Z). Pool loads at the retried timeouts were 215–272 in run-pass-miri (40j: 97–158). Despite this, the retried set is the same 15 cases. Every solo time is within ±1.0 s of 40j, and `nested_panic_caught.rs` did not even time out in the pool this time. Several suites were slower: hir-tree +228 s, hir-tree-nocore +116 s, mir-o2 +113 s, mir +313 s. The heavy suite was 1,337 s faster, because `task-comm-5.rs`/`task-comm-6.rs` were back to 41.8 / 157.8 s (40j: 199.4 / 1,320.4 s; w40j-audit N2 did not recur). Total suite time was 22,794 s against 22,788 s. Swap 5.3–7.1 GB throughout. I cannot tell from the samples whether the extra load was the gate's own pools or other work. | `gate.json` `host.samples`, `retryTimes`, per-suite `startedAt`/`endedAt` (§5) |
| N4 | info | **`step_overflowing.rs` is the same unprotected timeout.** It timed out at 1,800 s in `run-pass-miri-heavy` in waves 40i, 40j and 40k. It is not in `run-pass-miri-heavy.txt` (6 ids). It is protected in 18 other suites, all `MATCH`. Its max RSS rose to **4,821 MB** (40j 1,911, 40i 2,255) with user 1,840 s, which is still within the 12,288 MB budget. `hashset-connected-border-12860.rs` timed out the same way, also unprotected. | `run-pass-miri-heavy.summary.json` `heavy` (three gates) |
| N5 | info | **Disk:** 3.5 GiB free at the end of the audit. Wave 40j's builds (`b131654f…` 174 MB, `004c20b0…` 179 MB) are still in `subject-bin/`, and no accepted run needs them. The gate log is now `gate-w51.log` for `integ-w51`, so w40j-audit N5's off-by-one is gone. | `du`, `df`, `ls .data/tmp` |
| N6 | info | `bunExec` records the short revision that `bun --revision` prints (`38afee6c8`), while `bun` and `GATE_BUN` hold the full one. It is a prefix match, as `readBunExe` documents. The builds' `meta.json` mtimes (14:23Z) are later than `builtAt` (14:14:31Z / 14:14:36Z) only because a lookup touches `meta.json` (`scripts/lib/subject-bin.ts:504`); the content is the build's. | `gate.json`; `scripts/lib/bun-pin.ts` |

## 1. Protected set: nothing lost

| Check | Result |
|---|---|
| Baselines `9a03f050` = `ab750e50` = `95ba28aa` | `git diff --shortstat` over `harness/baseline`: empty; 60 files |
| Protected ids (`9a03f050`) against this gate's jsonl | **542,304, every one `MATCH`**, every one in the `95ba28aa` baselines (542,304 lines), no duplicates |
| `gate.json` | `pass: true`, `staticOk`, `skipStatic: false`, `head` `ab750e50`, `dirty: []`, `unstableOk`, `upstreamOk`, `unitTestSkips` 1 allowed 1, 0 unexpected, `staticNotes: []`. 60 suites, no `cli`. Summed over suites: `lost` 0, `lostSkipped` 0, `oracleTimeouts` 0, `upstreamChanges` 0, `gained` 0, batch-only failures and timeouts 0; baseline 542,304, match 542,304, total 542,643 (all equal to 40j) |
| `history.jsonl` accept entry (20:44:33Z) | run `gate-20261111-141426-root-vl2w`, head `ab750e50`, 60 suites, no `cli`; each `protected` equals its baseline's line count at `95ba28aa` (0 mismatches, sum 542,304) |
| `95ba28aa` | changes only `README.md`, `docs/next.md`, `docs/state/current.json`, `docs/state/history.jsonl` |
| Unstable | `miri-pass` `tests/panic/panic1.rs`, as before |

**Every row, this gate against wave 40j's.** The same 102 files, with the same ids in the same order. Every field is equal, except:

| Suite | Rows | Change | Explanation |
|---|---|---|---|
| `mir` | 6 | `attempts` only | the same 6 retried cases as 40j; solo times in §5 |
| `run-pass-miri` | 8 | `attempts` only | 8 of 40j's 9 retried cases, again retried |
| `run-pass-miri` | `tests/ui/threads-sendsync/issue-8827.rs` | `attempts` only | retried in both gates |
| `run-pass-miri` | `tests/ui/panics/nested_panic_caught.rs` | `retried` and `attempts` dropped, `MATCH` both | finished in the pool this time (w40j-audit N3) |

**Static steps** (`.data/tmp/gate-w51.log`): `note: subject binary (… 49a56593…, … 45bb8067…)`. Typecheck, unit tests, alone, runner, markers,
marker order, info sites and frozen lists are all `ok`, with 1 allowed skip. **Frozen lists:** the three jsonl files (plus two `.skipped`) are
byte-identical to 40j's, in binary mode with this gate's two hashes.

| Junit report | wave 40j | wave 40k |
|---|---|---|
| `unit-tests.junit.xml` | 7,453 (1 skip) | **7,539** (1 skip), 0 failures; the additions are llir-core-a's model/replay/proof tests, ssa-contract's `base.rs` helpers, stats; the one name that changed is `json.oracle.test.ts`'s temp path, as in every gate |
| `unit-tests.alone.junit.xml` | 39 | 39, the same names |
| `runner-unit-tests.junit.xml` | 446 | **537**, 0 failures; additions are scope-m7's scope/manifest/marker/C++-finder tests and bun-144's gate-bun tests; nothing gone |

## 2. Bun records

| Check | Result |
|---|---|
| `GATE_BUN` (`scripts/lib/bun-pin.ts` at `ab750e50`) | `1.4.4`, `38afee6c84fcf48c0edb2466aa4b27d287a59c30` |
| `gate.json` `bun` | equal |
| `bunExec.start` / `.end` | both `path` = `.data/gate-bun/run-73409-2sAj0A/bun`, `sha1` `7c1f29cd40510ed09854dff849e519411e374c13`, `1.4.4`, `38afee6c8`; `goodAt` 20:43:33.336Z |
| `bunClone` | same path, `from` `~/.bun/bin/bun`, sha1 `7c1f29cd…`, `how: clonefile`, `parent` 73409. `~/.bun/bin/bun` now: sha1 `7c1f29cd…`, `1.4.4+38afee6c8`; `~/.bun/bin` unchanged since 09:59:49Z |
| Clone removed | `.data/gate-bun/` is empty, last changed 20:43:33Z (the end of the run) |
| Builds' `meta.json` | both: `bun` 1.4.4 full revision, sha1 `7c1f29cd…`; `spec.bunPath` = the clone; `builtAt` 14:14:31.3Z / 14:14:36.1Z, after `ab750e50` (14:14:19Z) |
| `gate.json` `subject`, all 60 summaries, the 3 frozen-lists summaries | `mode: binary`, `49a56593…` / `45bb8067…` |

**Build keys, recomputed at `ab750e50`:**

| Entry | Recomputed | `gate.json` | inputs | `inputs` / `config` / `runtimeC` / `spec` vs `meta.json` |
|---|---|---|---|---|
| `src/rust_ts/main.ts` | `49a5659378eb60dacad8aabf854d668f9a325dc3` | equal | 2,111 | all identical |
| `src/miri/bin/miri.ts` | `45bb8067eaa87cd9f44b49ac0375e86b7cff19b4` | equal | 2,299 | all identical |

`runtimeC` is `src/std/thread.c` `453d4222…` and `src/rust_ts/proc_macro_host.c` `c1541cf1…`, the same as wave 40j's.

## 3. Expectation tampering: none

### Oracle keys

`scripts/oracle-keys.ts` over every registered case, in `git archive` trees:

| Tree, Bun | keys | sha1 | not listed |
|---|---|---|---|
| `103b447a`, 1.4.3 | 374,690 | `ed8bb636c17c…` | 0 |
| `ab750e50`, 1.4.3 | 374,690 | **`ed8bb636c17c…`** (`cmp`: byte-identical) | 0 |
| `ab750e50`, 1.4.4 | 374,690 | `a3e1b6e58756…` (= w40j-audit's `103b447a`@1.4.4) | 0 |

`103b447a`@1.4.3 → `ab750e50`@1.4.4: **0 gone, 0 added, 2,307 changed, all in 20 suites:** check-ui 730, rmeta-ui 730, mir-opt-o4 406,
host-rlib 222, check-ui-encode-mir 146, rlib-native 58, ir-hello 2, and 1 each in check-{alloc,chain,core,std,rg,rg-encode-mir,rg-host},
rmeta-{alloc,core,std} and miri-sysroot-{core,alloc,std}. `ab750e50`@1.4.3 → `ab750e50`@1.4.4 is the same set. These are the suites whose
oracle command is the Bun binary, which `difftest.ts:285` keys by the file's sha1.

### Reviewed batches

`git diff 103b447a ab750e50` outside `docs/` and `README.md`: 111 files. In `harness/`: `llvm-manifest.json`, `scope.json`. In `scripts/`: 22
files (`gate.ts`, `difftest.ts`, `coverage.ts`, `llvm-src.ts`, `subject-bin.cases.ts`, three gate tests, `coverage.test.ts`, and 13 under `lib/`).
In `tools/`: 9 files. Also `package.json`, `bun.lock` (`@types/bun` 1.4.4), `PORTING.md`, `PLAN.md`, and the rest in `src/`. **No change in
`harness/baseline`, `harness/corpus/`, oracle outputs, suite definitions (`harness/suites.ts` unchanged), `tsconfig.json`,
`bunfig.toml` or `UPSTREAM.json`.** bun-144 changed `scripts/difftest.ts`, which computes the oracle key; the key dumps above show it moved none. All six lanes branch from `103b447a`.

For each file, the heads that changed it, and whether the blob at `ab750e50` equals that head's:

| Head | Review (verdict, names the SHA) | Files equal to its blob |
|---|---|---|
| bun-144 `9bf84f4f` | bun-144-recheck3.md, APPROVE WITH NITS | 16 (13 in `scripts/`: gate, pin, difftest, common, subject-bin, unit-steps and their tests; `package.json`, `bun.lock`; `src/std/panic.ts`, `src/rustc_middle/mir/interpret/allocation.ts`, `src/rust_ts/track_caller.test.ts`) |
| stats `75357019` | stats.md, APPROVE WITH NITS | 13, plus `encoder.ts` (merge) |
| scope-m7 `f5d0a43d` | scope-m7.md, APPROVE WITH NITS | 13 (`scope.json`, coverage, llvm-src, cpp/rust-fns, `PORTING.md`), plus `llvm-manifest.json` (below) |
| ssa-contract `467f2b1b` | ssa-contract.md, APPROVE WITH NITS | 25 |
| driver-cli-2 `9d6c0635` | driver-cli-2.md, APPROVE WITH NITS | 17 (incl. the `tools/codegen` inputs the 2026-11-11 decision accepts), plus `encoder.ts` (merge) |
| llir-core-a `5c351241` | llir-core-a-recheck.md, APPROVE WITH NITS | 24 |
| root `4ce97419` | root-w51-check.md, APPROVE WITH NITS | `harness/llvm-manifest.json`: scope-m7's file + 13 added lines, 0 removed; equal at `ab750e50` |

- `src/rustc_metadata/rmeta/encoder.ts` (stats + driver-cli-2): `git merge-file` of the two lane versions over `103b447a`'s merges with 0
  conflicts and is byte-identical to `ab750e50`'s.
- `PLAN.md` is the same in three heads. It comes from root's `b3b29e88` (owner decisions D1/D3/D4) on main, before the lanes branched. It is a doc.
- No non-doc commit in `103b447a..ab750e50` lies outside the six lane heads and `4ce97419`.

**So every `harness/` and `scripts/` change came through a reviewed lane or the checked root commit.** No lane change is missing from the merge.

## 4. The re-run oracles

**Census of every moved key in the 13 gated Bun-oracle suites** (cache entry under the `ab750e50`@1.4.4 key):

| Suite | moved | written in its gate window | written before the gate (11-11) | same text and exit as the 1.4.3 entry |
|---|---|---|---|---|
| check-ui | 730 | 142 | 588 (10:56:59–11:41Z) | 730 |
| rmeta-ui | 730 | 147 | 583 (11:09–11:42Z) | 730 |
| mir-opt-o4 | 406 | 256 | 150 (from 11:08:18Z) | 406 |
| check-ui-encode-mir | 146 | 106 | 40 (12:36Z) | 146 |
| check-/rmeta- core, alloc, std; check-rg, -rg-encode-mir, -rg-host | 9 | 0 | 9 (12:43:30–12:51:58Z) | 9 |
| **total** | **2,021** | **651** | **1,370** | **2,021** |

No entry is missing, and none was written after the gate. The 287 moved keys of host-rlib, rlib-native, ir-hello, check-chain and
miri-sysroot-* have no 1.4.4 entry; those suites were not in the gate (N1).

**Spot-checks, protected cases.** The first five ids by sha1 order, then five more from inside the gate window where the first five were not:

| Suite (gate window) | Case | 1.4.4 key (= my dump) | 1.4.3 key | written | in window | code |
|---|---|---|---|---|---|---|
| check-ui (14:29:18–14:29:49Z) | `where-clauses/auxiliary/where_clauses_xc.rs` | `3f9e57f33a35` | `ca992ed6f020` | 11:41:21Z | no (N1) | 0 |
| | `privacy/auxiliary/private-extern-fn.rs` | `81eb9cdad90b` | `740e78f85132` | 11:10:01Z | no | 0 |
| | `lint/non-local-defs/auxiliary/non_local_macro.rs` | `4f1b6ff347ce` | `39bca2aec3cd` | 11:09:58Z | no | 0 |
| | `imports/auxiliary/glob-vs-expanded.rs` | `327073161fb6` | `5bf14c43bd4d` | 11:21:43Z | no | 0 |
| | `coherence/auxiliary/trait_impl_conflict.rs` | `310222f1e344` | `064f1c3f71ed` | 11:21:03Z | no | 0 |
| | `traits/const-traits/auxiliary/staged-api.rs` | `ab7ee7ea45e7` | `f94528d4f259` | 14:29:46Z | **yes** | 0 |
| | `suggestions/auxiliary/meow.rs` | `d87c85711db3` | `4291549b370a` | 14:29:44Z | **yes** | 0 |
| | `macros/auxiliary/deprecated-macros.rs` | `1f662f8fc6aa` | `020ac3878c75` | 14:29:35Z | **yes** | 0 |
| | `stability-attribute/auxiliary/stable-in-unstable-core.rs` | `6be0052346d2` | `70cc5e5acfdf` | 14:29:43Z | **yes** | 0 |
| | `union/auxiliary/union.rs` | `956f28ebb47a` | `3abb65d28771` | 14:29:48Z | **yes** | 0 |
| mir-opt-o4 (15:21:34–15:22:22Z) | `no_spurious_drop_after_call.rs` | `b736f8dc5d14` | `1ab243b33190` | 15:22:11Z | **yes** | 0 |
| | `inline/inline_empty_drop_glue.rs` | `284f6a547232` | `655b94ff38ed` | 15:22:03Z | **yes** | 0 |
| | `coroutine/async_drop_mir_pin.rs` | `c3e38c231394` | `6c4ed58884dc` | 15:21:48Z | **yes** | 0 |
| | `unreachable_enum_branching.rs` | `7e53fd979258` | `3def8f58eb67` | 15:22:21Z | **yes** | 0 |
| | `strip_debuginfo.rs#ALL` | `488de262916b` | `973a661ff5d9` | 15:22:20Z | **yes** | 0 |
| rmeta-ui (17:38:37–17:39:10Z) | `where-clauses/auxiliary/where_clauses_xc.rs` | `c56cd8cf1fd2` | `646757f5bd21` | 11:41:55Z | no (N1) | 0 |
| | `privacy/auxiliary/private-extern-fn.rs` | `d5697e706ad3` | `3c6df440be87` | 11:09:25Z | no | 0 |
| | `lint/non-local-defs/auxiliary/non_local_macro.rs` | `06f56ebf5d46` | `0aca61e74d27` | 11:09:22Z | no | 0 |
| | `imports/auxiliary/glob-vs-expanded.rs` | `2982aa62d0d5` | `1edec7d76566` | 11:24:58Z | no | 0 |
| | `coherence/auxiliary/trait_impl_conflict.rs` | `538e5ba03c26` | `362d2a092bc5` | 11:24:07Z | no | 0 |
| | `traits/const-traits/auxiliary/staged-api.rs` | `57f0a1c0d299` | `8b1cee21b2f2` | 17:39:07Z | **yes** | 0 |
| | `suggestions/auxiliary/meow.rs` | `33f8f3282eba` | `0047950e9cef` | 17:39:05Z | **yes** | 0 |
| | `macros/auxiliary/deprecated-macros.rs` | `03501d239fc5` | `4e76526cfc22` | 17:38:55Z | **yes** | 0 |
| | `stability-attribute/auxiliary/stable-in-unstable-core.rs` | `d3e4fbb4dc88` | `b342203debc8` | 17:39:04Z | **yes** | 0 |
| | `union/auxiliary/union.rs` | `26f441dbfa7d` | `f79f314466ce` | 17:39:09Z | **yes** | 0 |

Every key matches my 1.4.4 dump and differs from the 1.4.3 key. None timed out. Every text equals the 1.4.3 entry's. In mir-opt-o4, all 5
by sha1 order fell inside the gate window; in check-ui and rmeta-ui, all 5 by sha1 order predate it (N1).

## 5. Margins

**Solo retries** (`retryTimes` alone wall / user s; pool load at the timeout, 40j → 40k):

| Case | wave 40j | wave 40k | Δ wall | pool load |
|---|---|---|---|---|
| `dynamic-drop.rs` | 39.9 / 48.7 | **39.6 / 48.6** | −0.3 | 112 → 238 |
| `issue-8827.rs` | 39.3 / 46.6 | **39.0 / 46.6** | −0.3 | 154 → 234 |
| `error-tainting-issue-122904.rs` | 28.1 / 32.4 | 28.5 / 32.6 | +0.4 | 117 → 48 |
| `recursive-drop-elaboration-2.rs` | 28.1 / 32.4 | 28.5 / 32.6 | +0.4 | 136 → 57 |
| `recursive-drop-elaboration.rs` | 28.0 / 32.5 | 28.7 / 32.7 | +0.7 | 136 → 57 |
| `move-3-unique.rs` | 27.1 / 32.4 | 27.1 / 32.2 | 0.0 | 139 → 272 |
| `repeated-vector-syntax.rs` | 20.9 / 26.8 | 20.6 / 26.7 | −0.3 | 98 → 226 |
| `issue-52475.rs` | 19.5 / 20.3 | 20.5 / 21.2 | +1.0 | 165 → 125 |
| `recursion-etc.rs` | 16.6 / 18.7 | 16.8 / 18.9 | +0.2 | 120 → 242 |
| `unique-send-2.rs` | 16.1 / 22.9 | 16.2 / 22.5 | +0.1 | 97 → 234 |
| `infinite_loop.rs` | 15.5 / 16.2 | 15.5 / 16.2 | 0.0 | 165 → 125 |
| `macro-comma-support-rpass.rs#std` | 15.1 / 24.4 | 15.2 / 24.2 | +0.1 | 154 → 217 |
| `projection-cache-rematch-impl-141124.rs` | 13.9 / 18.3 | 14.4 / 18.6 | +0.5 | 121 → 57 |
| `let-else-drop-order.rs` | 13.7 / 20.7 | 13.6 / 20.7 | −0.1 | 151 → 215 |
| `macro-comma-support-rpass.rs#core` | 12.5 / 21.3 | 12.8 / 21.3 | +0.3 | 154 → 217 |
| `nested_panic_caught.rs` | 10.9 / 16.5 | not retried | — | 158 → — |

**No new retry.** The largest solo time, `dynamic-drop.rs` at 39.6 s, leaves 20.4 s of the 60 s limit and is 5.4 s under the 45 s line of the
2026-11-10 decision.

**Heavy suite** (one case at a time, wall / user s):

| Case | wave 40j | wave 40k |
|---|---|---|
| `dynamic-drop-async.rs` | 82.4 / 93.7 | 77.6 / 89.0 |
| `issue-94923.rs` | 89.3 / 95.6 | 86.0 / 92.2 |
| `example-calendar.rs` | 73.5 / 83.7 | 68.6 / 79.1 |
| `panic-handler-flail-wildly.rs` | 41.5 / 49.7 | 38.4 / 46.7 |
| `task-comm-5.rs` | 199.4 / 104.2 | **41.8 / 47.7** |
| `task-comm-6.rs` | 1,320.4 / 415.0 | **157.8 / 168.1** |
| `hashset-connected-border-12860.rs` | TIMEOUT 1,800 | TIMEOUT 1,800 (unprotected) |
| `step_overflowing.rs` | TIMEOUT 1,800, RSS 1,911 MB | TIMEOUT 1,800, RSS 4,821 MB (unprotected, N4) |

**Host.** `allowBattery` false, `powerLost` `[]`. 146 samples (14:14:26Z–20:43:33Z), all on AC, every one with a power reading, largest gap 657 s.
AC at both marks of all 60 suites. Load and suite times are in N3.

## 6. Coverage and criteria

`bun scripts/coverage.ts` at `95ba28aa`: **TOTAL 24,763 / 27,873 fns (88.84%) across 67 crates**, and **WRAPPER 32 / 218 (14.7%)** in 8
llvm-wrapper files. Both match the README (line 13) and `state.ts summary`. Miri 1,506 / 1,535; `rustc_codegen_ssa` 433 / 1,091;
`rustc_codegen_llvm` 0 / 820. `--check`: `markers ok (25786, 32 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311; library 735; llvm 174)`.

`scripts/criteria.ts --run gate-20261111-141426-root-vl2w` (gate at `ab750e50ba`, `pass=true`):

| Group | Result | Threshold |
|---|---|---|
| M6b run-pass | 3,474 / 3,478 = 99.88%, met | 90% |
| M6b run-fail | 294 / 294 = 100%, met | 90% |
| M6b miri-pass | 354 / 360 = 98.33%, met | 80% |
| M7a ir-hello | not met: "ir-hello: not in this gate" | 100% |
| M7a mir-o2 | 3,475 / 3,479 = 99.89%, met | 99% |
| M7a mono-ui | 3,475 / 3,479 = 99.89%, met | 99% |
| M7a check-rg | 34 of 34 crates, met | 33 |

All of these are unchanged from wave 40j, as expected for 0 gained.

## What I did not check

- **Protected cases beyond the gate's jsonl.** I re-ran no case; statuses come from the jsonl, compared row by row with 40j's.
- **The lanes' code and their open nits** (bun-144-recheck3, stats, scope-m7, ssa-contract, driver-cli-2, llir-core-a-recheck,
  root-w51-check). Those belong to their reviews. I checked only that the merged files are the reviewed ones.
- **Typecheck and the unit steps** were not re-run. I relied on the gate log and the junit reports.
- **Fresh oracle runs.** I did not re-run any oracle. The freshness argument in N1 rests on the key's contents and on the 1.4.4 entries
  equalling the 1.4.3 ones.

## Side effects outside my scratchpad

**No oracle cache entry was written** (0 files under `oracle-cache` newer than the start of the audit). **No subject build was made**:
`subject-bin/` holds the same four dirs. **No run dir was made.** The upstream checkout is clean (`git status --porcelain`: 0 paths), with no
`rustc-ice-*` file.
- `.env.local` was copied into this worktree, with `RUST_TS_REQUIRE_PROBES=1` and `RUSTUP_AUTO_INSTALL=0` appended (gitignored).
  `bun install --frozen-lockfile` linked this worktree's `node_modules` (gitignored).
- The key dumps called suites' `cases()`, which touched the mtimes of 814 cached aux entries under `aux/`.
- `coverage.ts` rewrote `$RUST_TS_DATA/coverage.json`, from this worktree at `95ba28aa`.
- The build-key recomputation ran `Bun.build` in memory over the `ab750e50` archive tree, and wrote no output.
- The two archive trees (about 140 MB each), the key dumps and my scripts were in my scratchpad only. I deleted the trees afterwards.
