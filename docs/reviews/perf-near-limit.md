# Independent review: perf-near-limit

Branch `t3/reduce-near-limit-runtime`, head `19231dda`, base `1adcee8e`. Line numbers are at `19231dda`. Read-only: every patch below
was in a scratch copy, and none is committed.

## Verdict: APPROVE WITH NITS

**I found no behaviour change.** I tried to break each change against the oracle and could not. None of the findings below is a wrong
result. The one worth doing soon is N1: the self-check that gives `StalledPrefix` its evidence is not in the tree, and a deliberately
broken `StalledPrefix` passes every permanent test.

**One answer root should act on before the next gate: the six extra retries at gate w39 line up with the laptop running on battery, not
with memory pressure.** See "Question (c)".

| id | severity | where | what |
|---|---|---|---|
| N1 | low-medium, test coverage | `src/rustc_trait_selection/solve/fulfill.ts:74` | No permanent test exercises `StalledPrefix` itself |
| N2 | nit, speed | `src/rustc_data_structures/sharded.ts:143` | `Array.from(v)` runs on every list passed to `intern_slice`, even with no observer |
| N3 | nit, speed | `src/rust_ts/intern_key.ts:349`, `:356` | Summing field hashes is nearly linear, so many values collide on a synthetic grid |
| N4 | nit, docs | `PORTING.md:152`, `src/rustc_middle/ty/context.ts:1895`, `:2816` | Still say interning goes through the key string |
| N5 | nit, handoff | `docs/handoff/perf-near-limit.md`, "The gate's retries" | The memory-pressure guess should be replaced by the battery evidence |

## N1: no permanent test exercises `StalledPrefix`

`write_watch.test.ts` covers the tables' reports well. Nothing permanent covers what `StalledPrefix` does with them: which table a
variable is marked in, `first_reader` keeping the lowest entry, or the opaque-count check. The lane's self-check was a temporary build.

**Failing scenario.** I changed `mark` so it keeps the latest entry instead of the lowest (M9 below). `bun test ./src/vendor/ena
./src/rustc_trait_selection` still gave 0 failures, while the same build exits 99 on 37 of my 41 programs. So a later change to
`inlined_rerunning_stalled_goal_may_make_progress`, or a new write path after an upstream bump, could make the compiler skip a goal that
upstream would rerun, and no test would catch it. Only a program with at least 64 pending goals reaches this code on a real build.

**Fix.** Add a test hook as `set_intern_shadow` does: on every pass, recheck each skipped entry with `goal_remains_stalled` and panic on a
wrong one, with `MIN_STALLED_LEN` lowered. Run it in a unit test over a few programs like those below. My generator is at
`/private/tmp/claude-501/-Users-tomernorman--t3-worktrees-rust-ts-t3-3fd69df3/73836649-473a-4d1a-aae5-32c21bb5983c/scratchpad/keep/gen.ts`
for whoever does this, but that is scratch and will not last.

## Nits

**N2.** `observe_interned(v instanceof Array && v.constructor !== Array ? Array.from(v) : v)` builds its argument before the function can
check for an observer. So `tcx.mk_args(args)` of an already interned list copies it each time, which is the allocation this lane set out
to remove. Test `observer` first. No effect on output.

**N3.** A literal's hash adds `hash_mix(C, field)`, and `hash_mix` is a multiply. On a grid of `Ref(r, t)` values, 100 regions by 40,000
types, 2,340,364 of 4,000,000 values shared a hash with an earlier one, and the largest bucket held 92. Random hashes would give about
1,900. Every hit is still followed by `value_eq`, so the result stays right. The lane saw 5 and 375 collisions on real programs, so this is
only a risk for a program that happens to fill such a grid. A final mix on each field's hash would remove it.

**N4.** PORTING section 5 says "Interning looks the value up by its canonical key", which is no longer how the type, region, const,
predicate, clause, list, canonical-input and external-constraint interners work. Root should update that section and record the decision.
The two `context.ts` comments need the same change. PORTING section 3 asks for a recorded decision only for a change of value
representation, and this is not one, so the lane broke no rule.

**N5.** "My guess is memory pressure when several 10-16 GB cases overlap" should be replaced. The handoff did say it was a guess.

## 1. `StalledPrefix`: no finding

**What upstream's check reads.** `inlined_rerunning_stalled_goal_may_make_progress` (`rustc_next_trait_solver/src/solve/eval_ctxt/fast_path.rs:43`)
reads the fast-path flag, `stalled_vars`, `sub_roots` and the opaque count, plus `should_rerun_after_erased_canonicalization` on the erased
path. `ty_or_const_infer_var_changed` uses `try_probe_value`, which reports a non-root as changed and never follows the parent. So each
stalled variable's own table slot decides its answer, and a later write to its root does not matter. That is what `watch_state` captures.

| input you asked about | outcome |
|---|---|
| inference variables unifying | Covered. Becoming a child or `Known` changes `watch_state`. Tested with chains in both directions and reverse order |
| region constraints, projection cache | Upstream's check does not read them either, so skipping cannot differ |
| opaque registration | Count compared at pass start and in `extend_over` |
| `Const` var, int and float vars | Each has its own table. Marking in the wrong table is caught (M1, M2) |
| snapshot rollback | Reported. See M7 for why my programs could not make that report matter |
| obligations registered in a pass | They go at the end of the list, above the prefix |
| `drain_pending`, `collect_remaining_errors_impl` | Replace the array, so the identity check ends the prefix |
| second context on one `InferCtxt` | `stalled_prefix_owner`; the displaced one starts over |

**Order.** The prefix entries are the first ones in the pass, nothing has been evaluated before them, and upstream would keep each one
without evaluating it. So evaluations, queries and diagnostics stay in the same order. The old solver is untouched:
`traits/fulfill.ts` and `obligation_forest` are not in the diff. The stale-mark argument in the handoff holds: marks only fall until
`forget` clears them, and an entry enters the prefix only through `extend_over` at its current index.

**How I tested it.** A scratch build rechecks every skipped entry at the start of each pass and exits 99 on a wrong skip, with
`MIN_STALLED_LEN` at 1 or at its real 64. Since the prefix entries come first in the pass, this is exactly upstream's check at upstream's
moment. All runs compare stdout, stderr and exit with the oracle, using `-Zunpretty=mir`.

| programs | threshold | result | entries skipped and rechecked |
|---|---|---|---|
| 134 of mine: reverse and forward unstalling, chains, int, float and const vars, rollback through failed coercion, unsizing, projections, nested `Vec`, closures, coroutines, async, specialization, overflow, late ambiguity, TAIT, recursive RPIT, higher-ranked, and 80 random mixes; 66-155 goals each, most with many errors | 1 | 134 MATCH | 173M |
| the same 134 | 64 | 134 MATCH | 194M |
| `tests/ui/traits/next-solver`, 356 of 357 (1 needs an aux crate) | 1 | 356 MATCH | 19,763 |
| 17 `tests/ui` directories, every second file, about 2,600 | 1 | MATCH but for 7 below; none exited 99 | 248,587 |

The 7: three `-Zwrite-long-types-to-disk=yes` tests whose file name holds a hash, which match once that flag is off (my runner's fault);
three UNPORTED, the same on base (`CodeStats` twice, parallel front end once); and `do_not_const_check.rs`, unprotected and listed as
unstable, the same on base.

**How strong the evidence is: deliberate bugs.** A program catching a bug means exit 99 (41 programs, threshold 1).

| mutation | caught by |
|---|---|
| M1 int and float vars marked in the type table | 18 |
| M2 const vars marked in the type table | 2 |
| M3 `sub_roots` not marked | 16 |
| M4 opaque count not compared at pass start | 2 |
| M5 the opaque-count check in `extend_over` removed | 0 |
| M6 only the first stalled var marked | 2 |
| M7 rollback does not report | 0 |
| M8 `update` does not report a changed state | 41 |
| M9 `first_reader` keeps the latest entry, not the lowest | 37 |

- **M7 is what reasoning predicts.** A fulfillment context only runs at its own snapshot depth, so a rollback undoes only writes made after
  the prefix was recorded, and each of those was already reported when it was written. The rollback report is a safe extra here, and the
  lane's unit test covers it.
- **M5 is only partly tested.** The branch is live: 1,334 hits over 1,195 next-solver, TAIT and `impl-trait` programs. No wrong skip came of
  removing it there, with 3 of those programs timing out at my 150 s limit. So the check may be stricter than needed, and it can only end
  a prefix early, which is safe. I could not show a program that needs it.

## 2. Interners: no finding

- **`value_eq` against the key text.** 400,000 generated pairs, 179,936 of them equal: `-0`, `0`, `NaN`, bigints around 2^53 and 2^64, numbers
  against bigints against strings, `undefined` against missing, null, field order, literal against class instance, `Object.create(null)`,
  interned stubs, and fields named `constructor`, `toString`, `valueOf` and `hasOwnProperty`. **0 mismatches**, in both argument orders, and
  equal values always hashed the same. Read against `key_of`, no branch is missing.
- **No false merge or split, and first interning unchanged.** The total of interned objects at exit is identical on base and HEAD on all 273
  programs I compared (236 from `tests/ui`, 37 of mine). A false split or merge would change it. This compares totals, not the id sequence,
  but `make` runs only on a miss and each memo calls the interner first, so reading agrees.
- **A stored value written after interning.** This is the lane's own worry, and now a real risk, as the stored value is what gets compared.
  A scratch build deep-froze every non-interned object stored by `intern_value` and `intern_slice`. No write threw on the 356 next-solver
  tests or the 2,600 others above. That is stronger than the lane's shadow table, which only saw a write if an equal value came along later.
- **Other users of those tables.** `contains_pointer_to`, `get` and `intern_ref` have no caller on a converted table.
- **Aliasing (`fixers-39` F1, `mir-alias`).** Interning stores the caller's object as before, so sharing is unchanged. What changed is that a
  write would now also cause a duplicate, and the freeze run found no such write.
- `id` order is unchanged, as above, and nothing orders on `id`.

## 3. Regions and types remembered by number: no finding

`ReVar(5)` and `Infer(TyVar(5))` are one interned object upstream, whichever `InferCtxt` asks. These memos hold only that object, per `TyCtxt`,
so an entry from another context is the right answer and no rollback can make it wrong. Variable numbers bound their size. The placeholder memo's
number pair decides the whole `RegionKind` when the bound is `Anon`, and `_tcx` is always `undefined`. Universes are part of that key.

## 4. `typing_env_no`: no finding

The memo keys on the identity of two immutable fields, and a miss still goes through `intern_key`, so numbers are given in the same order. `pack_def_id`
has `miri-perf` F1's fix (`krate` at 2^44, with a grid test). `miri-perf` F2's reproducer gives the oracle's output on HEAD. I did not rerun F1's
Miri program; its test covers the packing.

## 5. `GenericArg` folding: no finding

`Region`, `Ty` and `Const` are separate classes, so the test order cannot matter. The arms are the same, and `from_*` returns the interned object, so
returning the same object when nothing changed is unaffected. The allocated `GenericArgKind` was never visible to a caller, so nothing can now be sharing it.

## 6. Comments and order: no finding

Every change has a `// PORT(perf):` comment saying what upstream does and, except for the two self-fixes, the gain. The figures I checked are right. I
read no comment that overstates. No Miri file is in the diff. RNG draws and allocations are unaffected on reading. `coverage.ts --check` is ok (24,844
markers), `tsc --noEmit` is clean, and `bun test` on `vendor/ena`, `intern_key`, `typing_env_no`, `rustc_data_structures` and
`rustc_trait_selection` gave 310 pass, 0 fail.

## 7. Reproduction

`--sample 200`, `RUST_TS_AGENT=review-perf-near-limit`, `RUST_TS_REQUIRE_PROBES=1`, on HEAD:

| suite | total | MATCH | other |
|---|---|---|---|
| `borrowck-ui` | 200 | 200 | |
| `pm-ui` | 200 | 197 | `expand-expr.rs` UNPORTED; 2 UNSTABLE |
| `thirdump-ui` | 200 | 198 | 2 UNSTABLE |
| `mono-ui` | 200 | 199 | DIFF `callee_is_track_caller.rs`: unprotected, the same on base, the known codegen warning (decision 2026-11-05) |
| `mir-opt-o4` | 200 | 199 | `dump_dataflow.rs` UNPORTED, unprotected |
| `check-rg` | 36 | 36 | |

The table's instruction counts reproduce, on one basis: `/usr/bin/time -l`, one at a time, base and HEAD alternated, load 17-23 from other work. So compare
instructions and memory; wall and CPU run higher than the lane's quieter figures.

| case | Ginstr base | Ginstr HEAD | lane's | RSS MB base | RSS MB HEAD | wall s HEAD |
|---|---|---|---|---|---|---|
| `deep-try-chain-issue-153583.rs` | 316 | 62 | 319 to 61 | 939 | 898 | 13.2 |
| `hkl_forbidden.rs` | 744 | 426 | 750 to 424 | 6,961 | 4,220 | 39.2 |
| `param_mismatch2.rs` | 433 | 252 | 437 to 252 | 3,216 | 2,701 | 24.8 |
| `issue-52475.rs` | 443 | 321 | 441 to 321 | 707 | 702 | 23.6 |
| `variance-overflow.rs` | 69 | 61 | 70 to 61 | 828 | 773 | 4.7 |

`issue-52475.rs` printed as not matching in my timing script on both base and HEAD, and MATCHes through `difftest --filter`, as do `many-closures.rs`,
`deeply-nested_closures.rs` and `run-pass-miri`'s `dynamic-drop.rs`. I treat that as my script's fault, but did not find the cause.

**`rmeta-core`.** All 82,338 MATCH each time.

| run | side | max RSS MB | user s |
|---|---|---|---|
| 1 | HEAD | 12,148 | 175 |
| 2 | base | 13,311 | 141 |
| 3 | HEAD | 12,469 | 134 |
| 4 | base | 13,147 | 146 |

HEAD is 920 MB lower on average on two runs each, which is inside the spread `miri-perf` measured but the right direction. **No sign of retention.** The memos
hold objects the interner keeps anyway, and `StalledPrefix` lives as long as its `InferCtxtInner`. It does not put the budget at more risk than base: the reading
can still pass 12,288 MB (one HEAD run did, and both base runs), and that line is reported rather than failing the gate. Root may want to reset the budget, as
`miri-perf` said.

## 8. The lane's three questions

### (a) Stop freezing interned lists: root is right to decline for now

The gain is real but smaller than the handoff's on memory. On `hkl_forbidden.rs`, removing the one line takes 426 to 345 Ginstr (-19%) and RSS 4,212 to 3,328 MB
(-21%, one run each; the lane read -35%), with the output still matching.

Declining is right for two reasons, and this lane adds the second:
- `alias_check.ts:106` skips anything frozen, on the stated basis that writing to it throws. Unfrozen, the walker would go into every list and report each shared
  list as an alias, so `mir-alias`'s evidence would have to be redone.
- `slice_eq` now compares against the stored list. A write to an interned list would no longer just corrupt its sharers; it would also make a duplicate, so `===`
  breaks later and far away from the cause.

What would make it safe, all of it:
1. A switch that keeps the freeze, on for the alias sweep and for a sampled gate step, so writes still throw somewhere the project looks.
2. `alias_check.ts` recognising the `INTERNED` brand directly rather than through `Object.isFrozen`. `rustc_abi/layout/ty.ts:72` already checks the brand, so it is
   safe either way.
3. `RawList.prototype`'s mutators (`push`, `pop`, `splice`, `sort`, and so on) throwing in every mode. Index writes stay uncaught there, so also a check for casts of
   `List<T>` to a writable array.
4. A recorded decision, and PORTING section 5 updated.

Today's freeze is shallow, so list elements are not protected. My deep-freeze build shows no writes on about 3,000 programs. As a sampled gate step, it would protect
more than the current freeze does.

### (b) `supertrait-hint-cycle.rs`: it qualifies under A12's oracle-cost rule

I measured the oracle alone at 81 s wall, 77 s user, 12.19 GB and 937 Ginstr, at load about 10. The lane read 59-68 s. Either way the oracle itself does not fit under
the suite's 60 s, so no implementation could pass, and the cost is not about how the port does. That fits A12's sentence. Being unprotected, it risks no loss either way.

There is no heavy list for `mir` today, and the port did not finish in 420 s at about 16 GB. So I recommend one run alone at the heavy suites' 1,800 s limit. If it
finishes, add a heavy list. If not, skip it with this reason recorded, rather than spending 30 minutes at every gate. Either one also takes a 16 GB process out of a
12-job pool on a 24 GB host.

### (c) What `gate.json` should record, and why `variance-overflow.rs` timed out

**I cannot show memory pressure, and the evidence points elsewhere: the MacBook was on battery.** `pmset -g log` has `Using Batt` from 12:41:14 to 17:14:04 on 2026-11-05, with charge falling from 100% to 29%.

The suites that slowed are the ones in that window, and nothing else:

| suite | ended (local) | s at w39 | s at w38 | ratio |
|---|---|---|---|---|
| `hir-tree-nocore` | 12:34 | 2,059 | 2,100 | 1.0 |
| `hir-tree` | 14:52 | 8,305 | 2,350 | **3.5** |
| `mir-minicore` | 14:53 | 31 | 5 | **6.2** |
| `mir-o0` | 14:54 | 31 | 5 | **6.2** |
| `mir` | 17:38 | 9,859 | 3,543 | **2.8** |
| `mirdump-ui` | 17:41 | 195 | 186 | 1.0 |
| all later suites | | | | 1.0-1.2 |

Within `mir`, the modification times of the diff files give a timeline. The gate records no per-case times, so these come from the UNSTABLE cases' files:

| position in `mir` | w39 local time | cases/s at w39 | cases/s at w38 |
|---|---|---|---|
| 0 to 2074 | 14:54 to 15:24 | **1.1** | 5.8 |
| 2074 to 4693 | to 15:58 | **1.3** | 6.7 |
| 4693 to 12219 | to 16:53 | 2.3 | 6.8 |
| 12413 to 16992 | to 17:18 | 3.3 | 7.2 |
| 16992 to 18561 | **after AC returned at 17:14**, to 17:22 | **6.0** | 6.8 |

All six cases retried only at this gate sit at positions 2753 to 4740, at or just past the end of the slowest stretch: `inherent-impls-overflow`, `variance-overflow`, `deeply-nested_closures`, `many-closures`, `infinite_loop` and
`issue-52475`. The lane could not reproduce them with 12 jobs, which fits, as its runs were not on battery. `hir-tree` has no 10-16 GB cases near that, so overlap among large cases cannot explain it.

**Limits of this.** It is a strong correlation; I did not unplug the machine. A 5x average does not by itself turn 3.9 s into 60 s, so I have not explained that one case's full size. The rate also rose while still on battery, about when the display went off at 15:41, which may be the power
budget but which I did not test. Log samples at 15:10-15:20 show no memory-kill or pressure lines from the kernel. No sleep happened (`sleep 0`, no sleep events).

**What this means.** The six need no speed work, and they should drop out at a gate run on AC power. A gate on battery can also turn a timeout into a protected loss, and so a STOP.

**`gate.json` should record:**
- **Power source and charge** at each suite's start and end (`pmset -g batt`), and the gate should warn or refuse on battery. On macOS this is the first thing to add.
- **Each suite's start and end time.** The gate has only a duration, so I had to work this out from file times.
- **Load average and swap in use** at the same points.
- **Each retried case's** time in the pool, time alone, and peak RSS, as `docs/reviews/m6-audit.md` F1 asks.
- **Optionally, the cases/s curve within a suite.** This table took file times to rebuild.

These belong in their own harness batch.

## Reviewer's own incident

My first comparison runner ran in the upstream checkout without `RUSTC_ICE=0`, and three tests' own `-Zwrite-long-types-to-disk=yes` overrode the flag I passed. It left four files in `$RUST_TS_DATA/rust`, which would have made difftest and the gate refuse the checkout. Root noticed. I stopped the run, confirmed the
files were mine, deleted those four and fixed the runner. `git status --short --ignored` there now shows only `!! build/`. The ICE file came from the **oracle** on `tests/ui/consts/const-eval/do_not_const_check.rs` (`machine.rs:460`, "calling non-const function `mostly_harmless`"). That test expects an ICE (`failure-status: 101`), so it is not a finding. That case is
unstable in `mir`, and its output differs from the port's in the same way on base.

## Not checked

- The gate and full suites, as instructed. "No protected case is lost" rests on samples and the runs above.
- In my direct runs: revisions, revision-scoped flags and aux-crate tests (about 30 skipped). The broad set is every second file of 17 directories.
- `-Zdisable-fast-paths` was not run. By reading, `goal_remains_stalled` is then always false, so no entry enters the prefix.
- The id sequence, beyond the totals on 273 programs.
- Miri, beyond `dynamic-drop.rs`. The lane sampled `run-pass-miri`; I relied on no Miri file being in the diff.
- Heap contents: I read RSS, not a heap snapshot.
- Processes with more than one `TyCtxt`.
- Reproducing the battery effect, or the full cause of the slowdown. The kernel logs were sampled, not read for the whole window.
- The lane's `run-pass-miri` table rows, `recursive-drop-elaboration*`, and `self-referential-4.rs`.
- The rest of the first broad run's summary: I stopped it early to clean up, so its count is from its non-match files and skip counters, not a final report.
