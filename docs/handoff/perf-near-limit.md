# Handoff: perf-near-limit

Branch `t3/reduce-near-limit-runtime`, based on `1adcee8e`. Speed work on the cases that matched only through the gate's serial retry. No representation
change, nothing touched in `harness/`, `scripts/` or baselines.

## Result

Of the 18 cases, **12 are now clearly under their limit, 2 are just above the 60% aim, and 4 cannot be brought clear.**

- 10 protected `mir` cases: 36% of the limit or less, alone on a quiet host.
- 2 of the 4 protected `run-pass-miri` cases are clear too, but this lane **did not speed up any of the four**: their instructions are
  unchanged. They were already this fast when quiet, and `dynamic-drop.rs` (66%) and `issue-8827.rs` (63%) stay above the aim.
- 4 unprotected `mir` cases still time out: three at 108-120% of the limit, and `supertrait-hint-cycle.rs`, whose oracle alone
  takes about the whole limit.

The limit is 60 s for all. Both columns are on one basis: `/usr/bin/time`'s user + sys as CPU, one case at a time, base (`1adcee8e`) and HEAD
alternated, at the load shown. `% limit` is HEAD's wall. Every run that finished, before and after, hashes the same as the oracle
(stdout, stderr, exit), and the 14 protected cases MATCH through `difftest --filter` on HEAD.

| case | prot. | CPU s before | CPU s after | wall s before | wall s after | % limit | Ginstr before | Ginstr after | RSS MB before | RSS MB after | oracle CPU s | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `try-trait/deep-try-chain-issue-153583.rs` | yes | 36.2 | **6.6** | 34.0 | **4.2** | 7% | 319 | 61 | 970 | 897 | 1.7 | 2 |
| `type-alias-impl-trait/hkl_forbidden.rs` | yes | 46.9 | **26.4** | 41.5 | **21.3** | 36% | 750 | 424 | 7,109 | 5,467 | 1.5 | 3 |
| `type-alias-impl-trait/self-referential-4.rs` | yes | 35.3 | **19.7** | 31.7 | **16.5** | 28% | 635 | 380 | 1,713 | 1,588 | 1.3 | 2 |
| `type-alias-impl-trait/param_mismatch2.rs` | yes | 30.8 | **16.4** | 27.4 | **13.0** | 22% | 437 | 252 | 3,178 | 2,687 | 0.9 | 3-5 |
| `consts/const-eval/issue-52475.rs` | yes | 21.2 | **14.7** | 19.5 | **13.5** | 23% | 441 | 321 | 700 | 696 | 2.9 | 2 |
| `consts/const-eval/infinite_loop.rs` | yes | 16.9 | **11.1** | 15.4 | **9.7** | 16% | 361 | 254 | 696 | 687 | 2.3 | 2 |
| `closures/deeply-nested_closures.rs` | yes | 10.3 | 9.8 | 7.8 | 7.4 | 12% | 191 | 187 | 972 | 869 | 0.8 | 5 |
| `closures/many-closures.rs` | yes | 15.7 | 14.6 | 6.8 | 6.3 | 11% | 157 | 151 | 2,041 | 1,357 | 0.3 | 2 |
| `checked-type-alias/inherent-impls-overflow.rs` | yes | 7.0 | 6.5 | 5.4 | 4.7 | 8% | 101 | 87 | 931 | 860 | 0.5 | 4 |
| `checked-type-alias/variance-overflow.rs` | yes | 5.7 | 4.8 | 3.9 | 2.9 | 5% | 70 | 61 | 821 | 764 | 0.3 | 5 |
| run-pass-miri `drop/dynamic-drop.rs` | yes | 48.1 | 48.5 | 39.8 | 39.9 | **66%** | 494 | 491 | 2,179 | 2,151 | 4.1 | 4 |
| run-pass-miri `threads-sendsync/issue-8827.rs` | yes | 46.3 | 44.9 | 38.8 | 37.5 | **63%** | 497 | 496 | 2,000 | 1,985 | 4.2 | 3 |
| run-pass-miri `moves/move-3-unique.rs` | yes | 30.9 | 30.5 | 25.5 | 25.1 | 42% | 363 | 362 | 1,350 | 1,344 | 3.1 | 3 |
| run-pass-miri `array-slice-vec/repeated-vector-syntax.rs` | yes | 24.7 | 24.7 | 19.0 | 19.3 | 32% | 281 | 281 | 1,595 | 1,577 | 2.0 | 2 |
| `type-alias-impl-trait/recursive-drop-elaboration.rs` | no | 177.7 | **79.3** | 164.0 | **72.0** | **120%** | 2,462 | 1,307 | 13,071 | 10,373 | 4.8 | 4 |
| `type-alias-impl-trait/recursive-drop-elaboration-2.rs` | no | 181.5 | **77.7** | 168.1 | **69.8** | **116%** | 2,468 | 1,318 | 13,448 | 10,661 | 4.8 | 5 |
| `type-alias-impl-trait/error-tainting-issue-122904.rs` | no | 150.6 | **72.1** | 136.9 | **64.6** | **108%** | 2,465 | 1,313 | 14,044 | 10,384 | 4.8 | 3-12 |
| `closures/supertrait-hint-cycle.rs` | no | not finished | not finished | >420 | >420 | over | >4,684 | >5,732 | 13,587+ | 15,971+ | 59-68 | 4-5 |

Notes on the table:
- **Load moves these figures a lot.** The same build of `deep-try-chain` took 36 s CPU at load 2, 53 s at load 15 and 90 s in the first baseline run;
  `dynamic-drop.rs` took 48 s at load 4 and 85 s at load 30-35. Instructions barely change. Do not compare CPU across loads.
- **`deep-try-chain` on base** went over its limit alone in one of three runs (90 s wall, then 58 s and 34 s), which is how close it was.
- **`supertrait-hint-cycle.rs`** stopped at my 420 s limit on both sides. HEAD's `Ginstr` is larger only because it got further in the same time;
  neither tells how much is left. CPU reached 1,178 s in 421 s wall on HEAD, so the collector is working hard at about 16 GB.

### Which have room against the oracle

| group | port / oracle CPU | room? |
|---|---|---|
| `deep-try-chain` | 4x (was 21x) | none needed |
| `checked-type-alias/*`, `closures/*` | 12-50x, nearly all of it start-up (about 3 s against 0.1 s) | none needed |
| `consts/const-eval/*` | 5x | none needed; interpreter loop |
| `hkl_forbidden`, `param_mismatch2`, `self-referential-4` | 15-18x | some: see the proposal |
| `recursive-drop-elaboration*`, `error-tainting` | 15-17x. **The oracle works hard here too**: 77 Ginstr and 1.15 GB of its own, on a program of a few lines | needs another 2x to reach 60%, not in sight |
| `supertrait-hint-cycle` | the oracle takes 59-68 s and 11.6 GB, so this cannot pass under a 60 s limit even at the oracle's own speed | none |
| Miri four | 10-12x, flat profile | little: see below |

## What was changed

One commit each. `Ginstr` is the case named, normal JIT.

| change | what upstream does | measured |
|---|---|---|
| `StalledPrefix` + ena `WriteWatch` (`solve/fulfill.ts`, `ena/snapshot_vec.ts`, `backing_vec.ts`) | rechecks every pending goal on every pass | `deep-try-chain` 319 to 61; 426M of 457M checks skipped |
| interners use `value_hash` + `value_eq` (`rust_ts/intern_key.ts`, `sharded.ts`, `ty/context.ts`) | a hash and `==`, as this now does | `param_mismatch2` 439 to 391, `hkl_forbidden` 731 to 667, its RSS 7.4 to 6.1 GB |
| memos by variable number (`CommonLifetimes`, `CommonTypes`) | pre-interns 20-500, interns the rest each time | `param_mismatch2` 391 to 265, `self-referential-4` 591 to 402 |
| `typing_env_no` two entries | no such function | `issue-52475` 442 to 333 |
| `for in` on literals in `value_hash`, `value_eq` | n/a | `param_mismatch2` 273 to 259 (sync JIT) |
| `GenericArg::fold_with` without allocating `GenericArgKind` | `kind()` is free there | `recursive-drop-elaboration` 1,348 to 1,320 |
| `value_eq` counts defined fields; `StalledPrefix` skips an empty record | fixes of this lane's own, found rereading it | none: see below |

**No packed keys were added.** `value_hash` only picks a bucket and every hit is followed by `value_eq` on the whole value, so a collision costs a comparison. Collisions
seen: 5 in 204,600 entries (`hkl_forbidden`), 375 in 422,353 (`many-closures`). The memos are plain arrays indexed by one number, and `placeholder_anon_memo` an array of arrays.

**Please review hardest:**
1. `StalledPrefix`, whose header lists every input of the check and why each is covered. The riskiest point is `first_reader` after entries shift: a stale mark
   must only ever be too low, and I argue that from "entries re-enter the prefix only by passing through `extend_over` at their new index".
2. `value_eq` compared with the key text. Known difference, deliberate: field names outside `[A-Za-z0-9_$]` can make two key texts equal (`{"a:1,b": 2}`, `{a: 1, b: 2}`), which
   no Rust field name can do.
3. A stored value written to after interning used to be invisible (the key was taken once) and would now make a duplicate. The shadow checks below found none, but they saw only what they ran.

The `value_eq` bug, for the record: the first version's second loop read `ra[k]`, and for a name every literal inherits, like `constructor`, that is a function, so a field only `b` had was missed.
Unreachable today, since two values in one table with different fields differ in `$` first. The generated-pairs test did not catch it, as it generates no such name; it has its own test now.

## Correctness

On HEAD's code (the last commit changes comments and this file only):
- `--sample 200`, 0 DIFF, 0 CRASH, 0 TIMEOUT in all, `RUST_TS_AGENT=perf-near-limit-2`: `mir` 200 MATCH; `mir-o2` 200; `mono-ui` 200; `run-pass-miri` 200; `borrowck-ui` 200;
  `tydump-ui` 199 and 1 UNSTABLE (`traits/error-reporting/conditionally-implemented-trait-long-type.rs`, the long-type pattern).
- With `RUST_TS_AGENT=perf-near-limit` on the commit before the last two code fixes: the same, except `tydump-ui` 199 and 1 UNPORTED, `tests/ui/layout/gce-rigid-const-in-array-len.rs`, unprotected and UNPORTED with the same reason at the gate.
- `rmeta-core`: 82,338/82,338 MATCH. Max RSS 10,454 and 12,019 MB against the 12,288 budget, 149 and 146 s user. The last gate read 9,707 MB and 144 s on base, and `docs/reviews/miri-perf.md` read 11,401-13,289 MB on an older base when quiet, so RSS shows no proven change. Interning keeps fewer strings, but these two runs do not show a fall; watch this figure at the gate.
- `bun test` on `rust_ts`, `rustc_middle`, `rustc_data_structures`, `rustc_infer`, `rustc_type_ir`, `rustc_next_trait_solver`, `rustc_trait_selection`, `vendor/ena`: 1,074 pass, 0 fail before the two
  small fixes; `rust_ts`, `rustc_data_structures`, `vendor/ena`, `rustc_trait_selection` 352 pass, 0 fail after. `tsc --noEmit` clean, `coverage.ts --check` ok (24,844 markers).
- Unit-time budget: `write_watch.test.ts` and `sharded_value.test.ts` take under 0.2 s. `intern_key.test.ts` took 8.2 s CPU against 9.3 s on base, so its shadow table does not show above the noise. Well under 5 s.

**Self-checks that are not in the tree.** A temporary build, with `MIN_STALLED_LEN` at 1 so every list uses the prefix, that re-ran `goal_remains_stalled` on every skipped entry and
exited 99 on a wrong one, and kept a shadow table keyed by `intern_key` that exited 99 on a different object:
- no failure on `mir`, `mir-o2`, `mono-ui`, `tydump-ui`, `borrowck-ui`, `thirdump-ui`, `check-ui`, `run-pass-miri`, each `--sample 200`, on `1579388c`. All MATCH or UNSTABLE, except `move-3-unique.rs` in `run-pass-miri`, TIMEOUT under the self-check, and MATCH on the real build.
- the stalled-prefix part alone, with no failure, on `mirdump-ui` and all 328 of `tests/ui/type-alias-impl-trait`. The commit message says "all"; 3 of the 328 timed out under it.
- those 3 afterwards, on HEAD's code, both self-checks, with a 590 s limit: output hashes and exit equal to the oracle's. `deep-try-chain`: MATCH with the stalled-prefix one.

**Permanent tests:** `write_watch.test.ts` runs every table operation against a model of what the check reads (removing the report in `update` fails it, and so does removing every `note` call);
`intern_key.test.ts` compares `value_eq` and `value_hash` with the reference key on 30,000 generated pairs and at the boundaries, including what is rejected; `sharded_value.test.ts` covers collisions; the corpus runner now checks a shadow table over real compilations.

Not run: `src/rustc_mir_transform/alias_check_oracle/sweep.ts`, as no MIR pass was touched. The gate and the full suites, as instructed. So "no protected case is lost" rests on samples and the checks above.

## The gate's retries

**I could not explain why cases this small were retried.** `variance-overflow.rs` takes 3.9 s alone and timed out at the gate. Running `mir` at 12 jobs on just `tests/ui/type-alias-impl-trait/` and on just
`tests/ui/closures/`, on base and HEAD, at low outside load:

| filter | base retried | HEAD retried |
|---|---|---|
| `type-alias-impl-trait/` | `hkl_forbidden` (MATCH) and the 3 unprotected | the 3 unprotected |
| `closures/` | `supertrait-hint-cycle` | `supertrait-hint-cycle` |

So `many-closures.rs` and `deeply-nested_closures.rs`, retried at the gate, were not retried here on base either; the gate's pool has something these runs do not. My guess is memory pressure when
several 10-16 GB cases overlap on this 24 GB host, but I did not show it. These runs are also smaller than the gate's.

**So I cannot promise the retried list empties at the next gate.** What I can say is that every protected `mir` case now has at least 2.8x headroom alone, and the three biggest that finish hold 20-26% less memory.

## Proposals for root

1. **Do not freeze interned lists (value-representation decision, not made here).** `RawList.of_slice` ends in `Object.freeze`. Trial with that one line removed, base being HEAD:

   | case | Ginstr | RSS MB | CPU s, one run, load 15-25 |
   |---|---|---|---|
   | `hkl_forbidden.rs` | 423 to 346 (-18%) | 5,085 to 3,282 (-35%) | 32.6 to 30.9 |
   | `recursive-drop-elaboration.rs` | 1,307 to 1,017 (-22%) | 10,373 to 7,748 (-25%) | not comparable (different loads) |

   Output hashes were unchanged on those two. Cost: a write to an interned list would no longer throw, and would silently corrupt. PORTING section 5 says these are frozen. Keeping the freeze under a test-only switch would give both, if root wants it. On its own this does not bring `recursive-drop-elaboration.rs` under 60%.

2. **Limits and heavy lists.** `plan-m6 A12` forbids moving a case to a heavy list because of how the port does. `supertrait-hint-cycle.rs` is different: the oracle itself takes 59-68 s and 11.6 GB, against the suite's 60 s. It is unprotected, so it costs only a 60 s retry and memory at each gate. I recommend root decide it on those grounds; I changed nothing.

3. **`gate.json` should record retry times**, as `docs/reviews/m6-audit.md` F1 already asks, and peak RSS per case if it can. Without them the question above cannot be answered from a gate run.

4. **Miri.** Bundling with bytecode (`docs/handoff/miri-perf.md`) saves about 13 of hello's 29 Ginstr, against 491 on `dynamic-drop.rs`, so it will not move these cases much.

## Why Miri did not move

The profile is flat: the top function on `dynamic-drop.rs` is `Ok` at 2.3%, then `lookup` 2.2%, `frame` 2.1%, and no file is above 7%. Validation and retagging are about 28% between them, and upstream does that work too. The largest candidates would give 1-2% each, and I need about 10% on `dynamic-drop.rs` to reach 60%, so I stopped. `miri-perf`'s finding that gains have flattened still holds.

## Gains have flattened elsewhere too

`recursive-drop-elaboration.rs` now: `value_hash` 8.9%, `GenericArg` `fold_with` 8.2% (taken before that commit), `value_eq` 7.5%, `freeze` 6.8%, `slice_eq` 5.3%, then 3.5% and down. Without proposal 1, what remains is the cost of building and comparing long lists, which upstream also does at about a fifteenth of the price.

## Files touched

`src/rust_ts/{intern_key,intern_key.test,intern_key_corpus,typing_env_no,typing_env_no.test}.ts`, `src/rustc_data_structures/sharded.ts`, `src/rustc_data_structures/sharded_value.test.ts`, `src/rustc_infer/decls.ts`, `src/rustc_middle/ty/{context,generic_args,sty}.ts`, `src/rustc_middle/ty/context/impl_interner.ts`, `src/rustc_trait_selection/solve/fulfill.ts`, `src/rustc_type_ir/sty/mod.ts`, `src/vendor/ena/{snapshot_vec,write_watch.test}.ts`, `src/vendor/ena/unify/backing_vec.ts`.

Coverage: no upstream function added or removed, markers unchanged. `unported(...)` left: none added. `// PORT:` decisions: only the `// PORT(perf):` comments.
