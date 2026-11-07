# Handoff: perf-heavy

Branch `t3/perf-heavy`, based on `26e61959`. Speed work on `tests/ui/closures/supertrait-hint-cycle.rs` (`mir-heavy`). Two code commits, no change to
what is computed, nothing touched in `harness/`, `scripts/` or baselines. **The second commit undoes a decision root made on 2026-11-06, so it needs
root's decision.** It drops cleanly on its own.

| commit | what | needs |
|---|---|---|
| `90fad7d0` | the `canonical_var_kinds` and `predefined_opaques_in_body` interners share equal list elements (`ShardedHashMap::share_elements`) | adversarial review |
| `0d4092c4` | interned lists stay frozen only under `bun test`, the alias checker and `RUST_TS_FREEZE_LISTS=1`; list mutators panic everywhere | **root's decision**, then review |

## Result

**The real case now finishes and matches the oracle: 1,250 s wall, down from a timeout at 1,800 s.** It is still memory-bound: its footprint is twice
the oracle's, and 744 s of the 1,250 are system time from memory compression on this 24 GB host.

The real case, alone, AC power. The port's "before" is the brief's 2026-11-06 run. My "after" run had load about 2 for its first 1,000 s, then 14-33
when other lanes started.

| | wall s | user s | sys s | max RSS MB | peak footprint MB | Ginstr | result |
|---|---|---|---|---|---|---|---|
| oracle | 60.2 | 59.0 | — | 10,647 | 12,136 | 938 | — |
| port before (`26e61959`) | >1,800 | — | — | 12,700+ | — | — | TIMEOUT |
| port after (`0d4092c4`) | **1,249.9** | 996.0 | 744.0 | 14,140 | 24,621 | 14,109 | stdout, stderr and exit equal to the oracle's |

Measured first on smaller inputs: the same file with `#![recursion_limit = "N"]` added. These take the same code path, give the same E0275, and match
the oracle at every N. The oracle grows about quadratically in N, in time and in memory. All runs were alone, with load 2-6. Base and head were built
from the same tree.

| input | side | wall s | user s | max RSS MB | Ginstr | port/oracle Ginstr |
|---|---|---|---|---|---|---|
| rl16 | oracle | 1.2 | 1.2 | 350 | 21.0 | |
| | before | 18.4 | 21.0 | 2,973 | 359.5 | 17.1x |
| | after | 15.2 | 17.2 | 1,719 | 287.0 | 13.7x |
| rl32 | oracle | 4.1 | 4.0 | 893 | 69.0 | |
| | before | 58.7 | 62.6 | 6,694 | 1,127.7 | 16.3x |
| | after | 48.4 | 51.0 | 3,066 | 887.6 | 12.9x |
| rl48 | oracle | 9.3 | 9.1 | 1,771 | 144.4 | |
| | before | 194.6 | 168.4 | 10,053 | 2,570.7 | 17.8x |
| | after | **94.4** | 98.0 | **5,368** | 1,828.9 | 12.7x |

## The profile and the causes

**Before:** about 17x the oracle in instructions at every size, with memory at 5-7x the oracle's. Measured at rl16 to rl48, the instruction ratio is
flat, so nothing is quadratic in the port that is linear upstream. At full size the oracle alone needs 10.6 GB. At 5-7x the port could not fit in RAM,
which is the 30x.

The time is all in the next solver: typeck of the TAIT's defining body, reached from `check_opaque`, then `evaluate_root_goal`, canonicalization,
instantiation of query responses, and folding. The self-time top at rl16 was `value_eq` 7.7%, `freeze` 7.6%, `fold_list` 5.5%, `slice_eq` 4.9%,
`field_hash` 4.8%, `value_hash` 4.5%, `get_or_insert_bound_var` 3.9%, ena `get` 2.9%. **Memory explained the rest.** A heap census by object shape
(JSC heap snapshot, `Bun.gc(true)` first, 1.5M interned slices into rl16) found two causes, both in the contents of interned lists:

1. **Frozen arrays are sparse in JSC.** `RawList.of_slice` ends in `Object.freeze`. JSC cannot keep an array whose elements are non-writable as a
   vector, so it moves them into a `SparseArrayValueMap`: one hash entry per element, and a lookup per read. At that point 29,312 lists held 3.47M
   elements that way. In a micro-benchmark of 7M elements, frozen arrays took 2.6x the memory, 13x the build time and 8x the read time. At rl32 the
   interned lists hold 69M elements: `args` 50M, `canonical_var_kinds` 11M, `predefined_opaques_in_body` 7.5M (slice-interner counts, misses only).
2. **List elements are fresh objects per list.** Upstream's `List::from_arena` copies each `Copy` element into the arena: a `CanonicalVarKind` is
   about 24 bytes in each list. In the port, the canonicalizer builds new element objects on every canonicalization:
   `{ $: "PlaceholderTy", _0: { universe, bound: { var, kind } } }` is three objects, and `(OpaqueTypeKey, Ty)` is an array plus a key object. The
   lists keep them. The census had 600k `{$,_0}`, 537k `{bound}`, 385k `{kind}`, 564k `{args}` and 684k tuple arrays live, against about 14k
   distinct values. The rl32 heap was 2.4 GB live after a forced full GC, against the oracle's 0.9 GB total.

**After both changes**, the live heap after a full GC is about the oracle's total: 1.7 GB at rl48, against its 1.77 GB, and 1.05 GB at rl32. The
census shows 10x fewer plain objects (279k against 2.58M) and no sparse maps. What remains above the oracle is not live data. After a full GC at rl32,
JSC holds 1.05 GB live in 2.23 GB of block capacity, and `ps` RSS reads 3.35 GB. Long-lived objects are left spread over half-empty blocks by the
non-moving collector, and freed pages stay in RSS until the OS takes them back. Neither `bun --smol` (5,420 MB at rl48) nor a forced full GC every
2M or 6M slices (5,918 and 6,160 MB) lowers max RSS. **I stopped there: that is the runtime's constant factor, not the port's logic.**

## The changes

### 1. `share_elements` (`90fad7d0`)

`src/rustc_data_structures/sharded.ts`, `src/rustc_middle/ty/context.ts`: a table that shares keeps `value_hash` → the element objects its lists
hold. When `intern_slice` makes a new list, each non-interned object element that is `value_eq` to one already held is replaced by that object, in a
copy of the caller's array; the caller's array is never written. Element hashes come from the loop that already hashes the slice, kept in a reused
`Int32Array`, so no allocation per call. Enabled for `canonical_var_kinds` and `predefined_opaques_in_body` only. `make` now takes the elements to
store (`intern_slice(v, (v) => ...)`). Hits are unchanged.

**Why it cannot show.** A list hit already returns the stored list, whose elements are only `value_eq` to the caller's: key order may differ, and
`undefined` equals missing. So a caller can see nothing here that a hit does not already show it. What is new is that two different lists can hold one
object where upstream has two equal copies. Only `===` between elements of different lists, or a write to an element (to a stored list, already a
bug), could tell, and upstream compares these `Copy` values with `==`. First I wrote a stricter `same_value` (prototypes, key order, descriptors): it
cost 9% of instructions, and gave no more than the hit already gives, so I removed it. In all 14,405 buckets at rl16 the largest bucket held 1 entry.

**Measured.** A/B on rl16 with commit 2 in place, alternated 3 times each: on 288.9-291.3 Ginstr, off 289.6-290.8 Ginstr, user time equal. Max RSS on
was 1,709-1,716 MB, off 2,320-2,340 MB (-27%). Alone on frozen lists: rl16 360 against 359 Ginstr. The CPU profile charges it 6% of `value_eq`, but
instructions and user time show no cost, so read that 6% as sampling skew.

**Which test fails if it is wrong.** `sharded_value.test.ts` (3 tests): an unequal value must not be substituted (`{x:2,y:1}` against
`{x:1,y:2}`, and `-0` against `0`). The caller's array must not be written. A hit must register nothing. A non-sharing table must keep the caller's
objects. `interning.test.ts`: `mk_canonical_var_kinds` shares and still interns. A wrong substitution in the compiler would change canonical var kinds
and so the next solver's results, which the `mir`, `mir-o2` and `check-ui` samples and the near-limit cases below would show as DIFF.

### 2. Lists unfrozen outside tests (`0d4092c4`, root's decision)

`src/rustc_middle/ty/list.ts`: `RawList.of_slice` freezes only when `FREEZE_LISTS` is true. That is `RUST_TS_FREEZE_LISTS=1`, `NODE_ENV=test` (set
by `bun test`), or `RUST_TS_ALIAS_OUT` set, which sweep.ts sets for every alias-checker run. Everywhere, `copyWithin`, `fill`, `pop`, `push`,
`reverse`, `shift`, `sort`, `splice` and `unshift` on `RawList.prototype` panic (ICE), as a write to a frozen list threw before. `of_slice` fills by
index for that reason.

This answers what the perf-near-limit review asked for before unfreezing (`docs/reviews/perf-near-limit.md`, "What would make it safe"):
1. The freeze is kept where the project looks: unit tests, and the alias checker, whose evidence counted on writes to a list throwing. There is no
   sampled gate step: that needs `scripts/`, so it is root's.
2. `alias_check.ts` already skips by `instanceof RawList` (line 139), not by `Object.isFrozen`, and `rustc_abi/layout/ty.ts` checks the `INTERNED`
   brand. Neither needs a change.
3. Mutators panic in every mode. An index or `length` write to an unfrozen list is the one write not caught at run time; `List<T>`'s `readonly` type
   rejects it unless something casts. I added no check for such casts.
4. A recorded decision and the PORTING §5 wording ("frozen class instances", "`RawList`, a frozen `Array` subclass") are root's.

**Measured.** rl32 alone: 1,127.7 to 885.2 Ginstr (-22%), with RSS barely moved (6,694 to 6,493 MB). With commit 1 also in: 887.6 Ginstr and 3,066 MB.
Neither change alone brings RSS down much; together they halve it.

**Which test fails if it is wrong.** `interning.test.ts` "a list's in-place methods panic": all 9 mutators must panic, the list must be frozen under
`bun test`, and copies must stay writable. Nothing is computed differently, so only a write to a list could tell, and the frozen modes exist to catch it.

## Correctness

HEAD `0d4092c4`, `RUST_TS_AGENT=perf-heavy`, `--sample 200`:

| suite | MATCH | other |
|---|---|---|
| `mir` | 200 | |
| `mir-o2` | 199 | 1 UNPORTED: `rustc-env/def-path-hash-ice-157238.rs` (RUSTC_LOG `trace`); same on base `26e61959` |
| `check-ui` | 200 | |
| `mono-ui` | 199 | 1 DIFF: the same case, a trace-filter warning missing; same on base |
| `expanded` | 200 | |
| `run-pass-miri` | 199 | 1 UNPORTED: the same case; not protected in any of these suites |

- The real case: stdout and stderr byte-equal to the oracle's, the same exit (my own run, above). I did not run it through `difftest --suite mir-heavy`.
- rl8 to rl48: equal to the oracle at every size.
- `bun test` on `rustc_middle`, `rustc_data_structures`, `rustc_type_ir`, `rustc_next_trait_solver`, `rustc_trait_selection`, `vendor/ena`,
  `rust_ts/intern_key.test.ts`, `rustc_abi`, `rustc_ty_utils`, `rustc_infer`: 1,107 pass, 0 fail. Added unit time is under 0.1 s.
- `bunx tsc --noEmit -p .` clean, and `coverage.ts --check` reports markers ok (24,872). No upstream function added or removed: `sharded.rs` stays
  8/23 as on base, `list.rs` 22/22, `context.rs` 202/202.
- Not run: the gate, full suites, the alias sweep (no MIR pass was touched; it runs with lists frozen, as before).

## The same cause elsewhere

Each row was run alone, base `26e61959` against HEAD, with the same output hash on both sides. The four `mir` cases also MATCH through `difftest --filter`.

| case | wall s before | wall s after | RSS MB before | RSS MB after | Ginstr before | Ginstr after |
|---|---|---|---|---|---|---|
| `mir` `type-alias-impl-trait/recursive-drop-elaboration.rs` (unprotected) | 63.1 | **46.5** | 10,365 | **3,999** | 1,323 | 1,022 |
| `mir` `type-alias-impl-trait/recursive-drop-elaboration-2.rs` (unprotected) | 63.2 | **46.2** | 10,344 | **4,030** | 1,316 | 1,019 |
| `mir` `type-alias-impl-trait/error-tainting-issue-122904.rs` (unprotected) | 64.9 | **46.6** | 10,340 | **4,038** | 1,322 | 1,023 |
| `mir` `type-alias-impl-trait/hkl_forbidden.rs` | 20.2 | 16.0 | 4,043 | 1,911 | 427 | 353 |
| `run-pass-miri` `drop/dynamic-drop.rs` | 36.7 | 35.9 | 2,123 | 2,143 | 483 | 479 |
| `run-pass-miri` `threads-sendsync/issue-8827.rs` | 36.1 | 35.5 | 1,994 | 1,955 | 490 | 482 |
| `miri-sysroot-core` (MATCH) | 85.2 | 84.2 | 11,757 | **10,074** | — | — |

- **The three unprotected TAIT cases now finish under `mir`'s 60 s limit**, where they timed out. At 77% of the limit they are near-limit, so they
  could time out under load at the gate.
- **The Miri cases do not move.** Miri spends its time in the interpreter, not in interned lists, so the near-limit `dynamic-drop.rs` and
  `issue-8827.rs` keep their margin. Their wall here (36 s) is lower than the 40 s in perf-near-limit only because the host was quieter.
- **Core's sysroot build** holds 14% less memory, at the same speed.

## What remains

- **The real case is memory-bound.** The live data is now about the oracle's, but JSC's block capacity and RSS run 2-3x that, and
  `supertrait-hint-cycle.rs` needs a 24.6 GB footprint. On this host that is enough to page and compress. Without paging, 14,109 Ginstr would take
  about 750 s at the 18.5-19 Ginstr/s the port reaches here. It is in `mir-heavy` (1,800 s, 16 GB budget, report only), so this costs no protected case.
- **CPU is now the port's general constant factor**, 12.7-13.7x the oracle in instructions. The top of the rl16 profile after both changes is
  `value_eq` 15%, `value_hash` 6% and `field_hash` 5%: hashing and comparing canonical var lists in `finalize`, `canonicalize_input` and
  `canonicalize_goal`. Upstream does that work too, at the price of a hash over 24-byte values. Then `get_or_insert_bound_var` 4%,
  `GenericArg::fold_with` 3.5%, ena `get` 3% and `SnapshotVec` 2.6%, and nothing else above 2.3%. `get_or_insert_bound_var` matches upstream (a
  linear search up to 16 entries, then the lookup table).

## Proposals for root

1. **Decide commit 2.** If declined, drop `0d4092c4`. Commit 1 alone keeps its CPU neutrality but saves little RSS while lists stay sparse (6.4 GB
   against 6.7 GB at rl32). If accepted, record the decision, update PORTING §5's two "frozen" phrases, and update `alias_check.ts`'s comment
   (line 16), which is still true under the checker. Root might also add a sampled gate step with `RUST_TS_FREEZE_LISTS=1`. Coupling to name in the
   decision: `list.ts` reads `RUST_TS_ALIAS_OUT` so that the alias sweep keeps its freeze without a change to `alias_check_oracle/`.
2. **Adversarial review for both commits**, as PORTING's PORT(perf) rule asks. Points to try:
   - (a) a port path that compares two `CanonicalVarKind` or opaque-key objects by `===`, or keys a `Map` on one;
   - (b) a path that writes to a list's element after interning;
   - (c) `Array.from(v)` when `v` is itself a `RawList`, which `mk_args(args)` does;
   - (d) the `elem_hashes` scratch, which must be filled by the same call that reads it. No re-entrant `intern_slice` runs between the hash loop and
     `shared_elements`.
3. **Heap pressure, if root wants more.** The rest is JSC's non-moving heap. The one control I found that is not port logic is JSC's options, which
   the stack re-exec could set (`BUN_JSC_*`, as it already does for the stack). That would put another variable in the compiled program's
   environment, which `stack.ts` avoids for good reason. I did not try it.

## Files touched

`src/rustc_data_structures/sharded.ts`, `src/rustc_data_structures/sharded_value.test.ts`, `src/rustc_middle/ty/context.ts`,
`src/rustc_middle/ty/list.ts`, `src/rustc_middle/ty/interning.test.ts`, this file.

`unported(...)` left: none. `// PORT:` decisions: only the `// PORT(perf):` comments on `share_elements`, `shared_elements`, `elem_hashes`,
`CtxtInterners::new`, `FREEZE_LISTS`, `LIST_MUTATORS` and `of_slice`.

Measuring aids, all in the session scratchpad and not in the tree: a heap census by object shape over `Bun.generateHeapSnapshot()`, a slice-interner
counter, and a CPU-profile aggregator with a caller view. They were driven through a one-line `globalThis` hook in a scratch worktree only.
