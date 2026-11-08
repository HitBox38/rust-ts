# Independent review: perf-tait

**Verdict: APPROVE WITH NITS.** I found no behaviour change and no wrong key. The nits are three test gaps that let a broken length check or a
broken offset pass every test; none is a bug in the code as written.

Branch `t3/optimize-mir-performance`, head `ec231c60`, base `main` `519e6360`. Line numbers are at `ec231c60`. Read-only: every probe and mutation
below was in a scratch worktree, reverted, and none is committed. Host: the root Mac, AC power throughout, load 1-8.

| id | severity | where | what |
|---|---|---|---|
| N1 | low, test coverage | `src/rustc_middle/ty/context.ts:247`, `:363`; `src/rustc_middle/ty/element_eq.test.ts:80` | No test catches a missing length check in `CANONICAL_VAR_KIND_EQ.slice_eq` or `PREDEFINED_OPAQUE_EQ.slice_eq` |
| N2 | low, test coverage | `src/rustc_infer/infer/opaque_types/table.ts:112` | No test catches `entries_of` ignoring `skip_dups` (`opaque_types_added_since` with earlier duplicates) |
| N3 | nit, test coverage | `src/rustc_infer/infer/type_variable.ts:133` | No test catches the kept `sub_unification_table` view ignoring its log |
| N4 | nit, read only | `src/rustc_middle/ty/generic_args.ts:199-215` | `as_*` return `undefined` where `kind()` panicked, for a value that is no `GenericArg` |

## N1: the slice length checks are untested

Deleting `if (a.length !== b.length) return false;` from `CANONICAL_VAR_KIND_EQ.slice_eq` (`context.ts:247`), or from `PREDEFINED_OPAQUE_EQ.slice_eq`
(`:363`), leaves all 900 tests of `rustc_middle`, `rustc_infer`, `rustc_data_structures`, `rust_ts/keyed`, `intern_key`, `vendor/ena`,
`rustc_next_trait_solver` and `rustc_trait_selection` passing. *Reproduced (mutations R6, R6b).* The same check in `INTERNED_ELEMENT_EQ.slice_eq` is
caught (R9), by the corpus test, not by `element_eq.test.ts`.

**Failing scenario if someone drops it.** `slice_eq(a, b)` loops over `a.length`, so a list that is a prefix of a stored list compares equal. The table
only compares lists with one hash, and the hash starts from the length, so this needs a hash collision across lengths. Then a canonical input with
fewer variables gets the longer list, and the solver instantiates variables the goal does not have. Rare, far from its cause, and no test points at it.

**Why the test misses it.** `check_against_value_eq`'s pairs (`element_eq.test.ts:80`) have `[values, values.slice(1)]`, which differ at index 0,
but no pair where one is a prefix of the other. The table test's random lists rarely collide across lengths. **Fix:** add
`[values.slice(0, -1), values]` and `[values, values.slice(0, -1)]` to `pairs`.

Aside, not this lane's code: the generic `slice_eq` (`sharded.ts:49`, `VALUE_ELEMENT_EQ`) has the same gap (R6c survives too).

## N2: `entries_of`'s duplicate offset is untested

Changing `for (let j = skip_dups; ...)` to start at `0` (`table.ts:112`) passes every test above. *Reproduced (R17).* The lane's mutation "drop
duplicates" is caught, but no test calls `opaque_types_added_since` with `prev_entries.duplicate_entries > 0`. If broken, the next solver would
see the earlier duplicate entries again as newly added opaques after a canonical response. **Fix:** in `opaque_snapshot.test.ts` "the storage is
keyed by value", add a duplicate, take `num_entries()`, add a second one, and check `opaque_types_added_since` returns only the second.

## N3: the kept sub view's log is untested

Making `sub_unification_table_with_log` reuse its view whatever the log (`type_variable.ts:133`, drop `this.#sub_log !== undo_log_ ||`) passes
every test. *Reproduced (R21).* The same change to the `eq` view (R22) and to `with_log` (R23) is caught by `type_variable_views.test.ts`. It
cannot happen in production today, as each storage only ever sees one undo log object (below). **Fix:** compare `t2.sub_unification_table()` with
`t1.sub_unification_table()` in the first test, as it does for `eq_relations()`.

## N4: `as_*` on a non-`GenericArg`

`GenericArg::kind` panics (`panic_unreachable`) on a value that is no `Region`, `Ty` or `Const`. The new `as_region` / `as_type` / `as_const` return
`undefined` instead, so `expect_ty` and the like ICE with `bug!("expected a type, but found another kind")` rather than the unreachable panic. Only a
bug elsewhere can pass such a value, and both are exit 101. No action needed. *Read only.*

## 1. Typed hash and equality: no finding

- **Against upstream and `value_eq`.** Read against `rustc_type_ir/src/canonical.rs:96`: all 8 `CanonicalVarKind` variants are listed, with their fields
  (`Ty { ui, sub_root }`, `Region(ui)`, `Const(ui)`, and `Placeholder { universe, bound: { var, kind? }, _tcx }`). `BoundConst` has no `kind`, so
  both sides read `undefined`. `_tcx` is skipped, as `value_eq` skips `undefined` fields. `UniverseIndex` and `BoundVar` are branded numbers, never
  `-0`. A bound var's `kind` is compared by `value_eq`, so `Param(DefId)` and `Named(DefId)` compare by crate and index. `(OpaqueTypeKey, Ty)` is a
  branded `u32` and two interned objects. `GenericArg` is always interned: my checked build failed on any element without the `INTERNED` brand in the
  `args` table, and none came in 38M interns.
- **Hash agrees with eq.** Each hash reads only fields its eq compares. `hash_placeholder`'s `Anon` shortcut is safe, because `value_eq`-equal kinds
  share `$`. All results are int32 (`hash_mix` is `Math.imul(..) ^ (h >>> 15)`), which `ElementPool`'s `Int32Array` needs.
- **First-interning order unchanged** *(reproduced)*. In scratch copies of `main` and head, every fresh intern of `intern_value` and `intern_slice`
  went into a CRC of `id | intern_key(value)`. On all 1,190 programs that finished on both sides (`mir`, `tests/ui/{type-alias-impl-trait,
  traits/next-solver,impl-trait}`), the CRC and count are equal: 3,696,234 fresh interns. The 3 left out are the three cases, which my checked
  build ran past 60 s (below).
- **No duplicate, no merge** *(reproduced)*. In the head scratch copy, every `intern_slice` result of the three tables went against a shadow keyed by
  `intern_key` of the list, in both directions. 38,073,366 checks over those 1,190 programs: 0 duplicates, 0 merges.
- **Lane's mutations, sampled** *(reproduced)*: ignore the universe (R1), ignore `args` (R7), slice loop from 1 (R8), widen the bound (R12), return the
  new value (R13), log no `prev` (R15), skip off by one (R16), ignore the log for the eq and table views (R22, R23), and the wrong class (R24). Each
  fails a test. My own extra ones that fail: ignore the bound var or kind (R2, R3), Region grouped with Int (R4), no variant tag check (R5), number
  form without `def_id` (R10), text form without `args` (R11), replace stores the new key object (R14), pool hash not stored (R18), pool rehash
  from slot 0 (R19), `elements_eq` guard removed (R25).
- Equivalent mutants (fail nothing, change nothing): growth at 100% load (R20, still never full), a weaker `Ty` hash (R26). My R27, a hash that read
  `Object.isFrozen`, also survived. No test value is a frozen `Ty`, so it was not a fair test.

## 2. The packed opaque key: no finding

- **`def_id` is a `LocalDefId`** (`opaque_ty.gen.ts:12`, a branded `u32`, upstream `I::LocalDefId`). The storage only holds local opaques, so a
  foreign crate's opaque can never be a key, and the crate needs no bits. My checked build asserted a non-negative safe integer `def_id` and `args.id`
  on every call: 11,784,784 keys, no failure.
- **The bound is exact.** `(2^21 - 1) * 2^32 + (2^32 - 1) = 2^53 - 1`, `Number.MAX_SAFE_INTEGER`. The quotient and remainder by 2^32 recover both
  fields.
- **One form per key.** The form depends only on `(def_id, args.id)`, and a `Map` never equates a number with a string. In the 11.8M checks, one
  `intern_key` never gave two keys and one key never named two `intern_key`s.
- **The text form in a real compilation** *(reproduced)*. A scratch switch forced the text form on every key. Two crates with their own TAITs and
  RPITs, `xaux` (`--extern`, built by the oracle as rmeta) and a main crate with opaques over 8 and 16 generic args, nested through `xaux`'s opaques.
  A passing and a failing variant, each with and without `-Znext-solver`. Oracle, head, head checked and head with the forced text form give one
  stdout, stderr and exit each, 4 of 4. (A fifth "base" side ran while my worktree was detached onto head, §6, so it was head too.)

## 3. Kept views: no finding

- **Nothing replaces what a view points to** (read). There is no assignment to `.values`, `.undo_log`, `.logs`, `.eq_relations`,
  `.sub_unification_table` or `.type_variable_storage` anywhere in `src`, and no `Object.assign` onto these classes. `rollback_to` and `commit`
  pop or truncate `logs` in place (`undo_log.ts:316-349`). `finalize_rollback` truncates `values` in place. `InferCtxtUndoLogsAt` keeps the
  `InferCtxtUndoLogs` object, not its array. Forks clone the storage (`infer/mod.ts:147`), and a clone gets fresh `#` fields with no views.
- **Dynamic check** *(reproduced)*. On every reuse, my checked build asserted the view still points at the storage's current arrays, `WriteWatch`
  and log. 276,961,811 reuses over the 1,190 programs, many of them probes and rollbacks, with no failure.

## 4. Open addressing: no finding

Linear probing, growth when more than half full, no deletion. So the table is never full, and every probe ends at an empty slot. `grow` reinserts by
`slot_of` of the stored hash and installs both new arrays. In the checked build, each `share` was checked against a shadow keyed by `intern_key`:
25,179,788 calls, one representative per value, no failure. The pool test covers growth, and breaking the rehash fails it (R19).

## 5. Results

On head, `RUST_TS_AGENT=review-perf-tait` (a different sample from the lane's), `--sample 200 --jobs 4`:

| suite | result |
|---|---|
| `mir`, `mir-o2`, `check-ui`, `mono-ui`, `tydump-ui`, `rmeta-ui`, `expanded`, `run-pass-miri` | 200/200 MATCH each |
| `check-ui` `--sample 400 --seed review-perf-tait-beside` (beside the timing) | 400/400 MATCH |
| `mir --filter tests/ui/{type-alias-impl-trait,traits/next-solver,impl-trait}/`, head checked build | 1,209 MATCH, 3 TIMEOUT: the three cases, slowed by the checks (plain head MATCHes them, §6) |
| the same, `main` with the digest probe only | 1,212/1,212 MATCH |
| `check-core` (alone) | MATCH, 78.6 s wall, 127.7 s user, 9,649 MB (gate on `main`: 82.8 s, 9,034 MB; budget 12,288) |
| `bun scripts/frozen-lists.ts` | 48/48 MATCH |
| alias sweep, `--tests tests/ui --passing --sample 100 --modes o0,o2,o4,mono,dump` | 500 runs, 267,780 walks, **0 distinct hits**; 396 MATCH, 98 CHECKED, 1 FAILED (`address-of-never.rs`, which the oracle rejects too), 5 UNPORTED (one program, `llvm_util::configure`, unrelated) |
| alias sweep, `--tests tests/ui/type-alias-impl-trait --passing --modes o0,o2,dump` | 315/315 MATCH, 86,251 walks, **0 distinct hits** |

`bunx tsc --noEmit -p .` is clean. `coverage.ts --check` is ok (24,893 markers). `bun test` on the 8 directories above gave 900 pass, 0 fail.

**Hello** (`-Zunpretty=mir`, std), from `t3-68baf25f` (`main`) and `t3-rvptait1` (head), paths of equal length, alternated: base 11.98, 11.64, 11.62 G;
head 11.82, 11.59, 11.60 G. Same output as the oracle. No change.

**One of the three cases, every check on, to the end** (`recursive-drop-elaboration-2.rs`, checked head build, no time limit, alone): 71.7 s,
1,420 Ginstr, exit 1 and stderr equal to the oracle's by hash. 34,082,043 list checks, 31,164,959 pool checks, 14,133,519 opaque-key checks and
301,183,652 view reuses, with no failure. This adds the case that matters most to the 1,190 programs above.

## 6. Timing (reproduced)

`/usr/bin/time -l`, one process at a time, `cwd` the upstream checkout, `mir` suite argv. stdout is empty and stderr equals the oracle's by hash on every run.

| case | side | wall s | Ginstr | max RSS MB |
|---|---|---|---|---|
| `recursive-drop-elaboration.rs` | base | 46.2 | 1,020 | 3,987 |
| | head | 25.3, 25.3, 25.1 | 511-516 | 3,105-3,273 |
| `recursive-drop-elaboration-2.rs` | base | 45.7 | 1,016 | 4,022 |
| | head | 25.4, 25.1, 25.1 | 513 | 3,224-3,285 |
| `error-tainting-issue-122904.rs` | base | 46.2 | 1,022 | 4,036 |
| | head | 25.1, 25.1, 25.2 | 510-513 | 3,087-3,280 |
| oracle (each) | | 4.8 | 77.4 | 1,150 |

**Beside a 4-job sample** (head, the `check-ui` 400 above), one case after another: 31.8 s, 31.3 s, 27.4 s at load 5.5-8. The sample ended during
the third. That is 46-53% of the 60 s limit. This matches the handoff.

My process error, for the record: an early stray `git checkout ec231c60 --` detached my review worktree onto head. So my first "base" timing set
ran head (25 s, 511 G), and I threw it away. The table above is from after `git checkout t3/perf-tait-review` (`519e6360`), confirmed by
`git rev-parse` before each hello run. It also made the two-crate test's "base" side a head run (§2). The samples, the corpus, the digests, the
mutations, `check-core`, `frozen-lists` and the sweep used separate checkouts at the stated commits, so the error did not touch them.

## What I did not check

- `rmeta-core` (I ran `check-core` instead, as the lane ran `rmeta-core`), `mir-opt-o4`, and the full suites. No gate.
- A hash-collision stress of the three typed hashes on real programs (N1's scenario needs a collision; I tested the code as written, not a broken check).
- Windows.
- That the text form, which no real program reaches (it needs 2M local defs or 4G interned objects), is as fast. Only that it is correct.
