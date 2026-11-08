# Handoff: perf-tait

Branch `t3/optimize-mir-performance`, based on `519e6360` (`main`). Speed work on the three protected `mir` cases near their limit. No output change,
no representation change, nothing touched in `harness/`, `scripts/` or baselines. No `unported(...)` added, no upstream markers added or moved.

| commit | what |
|---|---|
| `83b6af47` | typed element hash/eq for three interners; type-variable views kept per undo log; one-lookup `register`; `GenericArg::as_*` without allocating |
| `18db5a74` | open-addressing element pool for `share_elements`; numeric opaque-type keys; `forEach` for the opaque storage's copies |
| `e83ed052` | stronger tests (found by the mutation runs below) |

## Result

**About 46 s to about 25 s alone, and 29-32 s beside a 4-job sample.** All three cases, at every run below, give stdout, stderr and exit equal to base's
(and to the oracle's, by hash, for `-2.rs`).

Alone, one process at a time, base (`main` checkout at `../t3-perfbase`) and head alternated, AC power. Load is the 1-minute figure during the run; nothing else
of mine was running.

| case | side | wall s (3 runs) | user s | max RSS MB | Ginstr | load |
|---|---|---|---|---|---|---|
| `recursive-drop-elaboration.rs` | base | 48.4, 46.1, 46.0 | 49.3-51.3 | 4,011-4,015 | 1,016-1,020 | 1.5-4.8 |
| | head | **25.8, 25.3, 25.2** | 28.4-28.8 | 3,199-3,262 | 513-515 | 1.5-4.2 |
| `recursive-drop-elaboration-2.rs` | base | 46.3, 46.1, 46.2 | 49.4 | 4,019-4,039 | 1,020-1,023 | 1.5-2.5 |
| | head | **25.3, 25.0, 25.1** | 27.9-28.3 | 3,133-3,254 | 510-514 | 1.4-2.2 |
| `error-tainting-issue-122904.rs` | base | 46.0, 46.2, 46.1 | 49.2-49.5 | 3,997-4,024 | 1,015-1,022 | 1.4-2.1 |
| | head | **25.1, 25.3, 25.0** | 28.0-28.1 | 3,131-3,225 | 510-512 | 1.5-1.9 |
| oracle (`-2.rs`) | | 4.9 | 4.6 | 1,152 | 77.7 | |

**Beside a 4-job sample** (head, `difftest --suite check-ui --sample 400 --jobs 4`, which gave 400/400 MATCH), one case after another:
31.8 s, 31.7 s, 28.9 s, at load 6-11. The sample ended during the third. That is 48-53% of the 60 s limit. Base timed out in this setting, 5 of 5
(`docs/reviews/w40d-audit.md` N1). I did not measure base beside a sample again.

Port/oracle in instructions: 13.1x before, **6.6x now**.

## The profile and the causes

`bun --cpu-prof` on `recursive-drop-elaboration-2.rs` (the stack re-exec keeps the flag). The case is typeck of `with_positive`'s body reached from
`check_opaque` through `mir_borrowck`, in the next solver (`evaluate_root_goal` from typeck's fallback), until E0275. The solver's canonical inputs carry
lists of about 300 elements: the opaque type storage (up to 554 entries) and the canonical variables (up to 833). Interning counts, from a temporary
counter (not in the tree):

| table | interns | elements | hits | element identity on hits |
|---|---|---|---|---|
| `args` | 33.7M | 170.6M (5 per list) | 99.7% | all (interned elements) |
| `canonical_var_kinds` | 160k | 52.0M (325 per list) | 82% | none: fresh objects every time |
| `predefined_opaques_in_body` | 192k | 53.7M (280 per list) | 64% | none |

**Before** (51.8 s profiled), self time: `value_eq` 17.0%, `value_hash` 6.6%, `field_hash` 6.2%, `key_of` 2.8%, `sorted_keys` 1.4%. By file,
`rust_ts/intern_key.ts` was **35.5%** of the run. Callers: `intern_slice` 34.6% inclusive (`value_hash` 13.1, `slice_eq` 10.4, `shared_elements` 7.5):
the generic walk over 106M fresh element objects of the two sharing tables, and 75M element compares on hits. Then the opaque type storage's `KeyedMap`
on `intern_key` (`register`, 9-10% inclusive), and the ena views (`SnapshotVec`, `UnificationTable`, `TypeVariableTable` constructors, 3-5 objects per
`probe`/`root_var`, about 8%).

**After** (26.4 s profiled, load 2), no function above 6.7%: ena `SnapshotVec::get` 6.7, `get_or_insert_bound_var` 6.4, the canonicalizer's
`fold_region` 5.2, `GenericArg::fold_with` 4.9, `intern_slice` 4.4. `intern_key.ts` is 3.0%.

## The changes

Each is a `// PORT(perf):` with what upstream does. Gains are Ginstr on `-2.rs`, measured as each landed (several at load 8-40, so instructions, not wall).

| change | files | upstream | Ginstr |
|---|---|---|---|
| `ElementEq`: a sharing table can take its element type's derived `Hash`/`PartialEq` as functions; `CANONICAL_VAR_KIND_EQ`, `PREDEFINED_OPAQUE_EQ` | `sharded.ts`, `ty/context.ts` | hashes and compares these elements with exactly those derives | 1,020 → 698 |
| `key_OpaqueTypeKey` for the opaque storage's `KeyedMap` (was `intern_key`) | `opaque_types/table.ts` | `FxIndexMap<OpaqueTypeKey, _>`: the derived `Hash`/`Eq` | → 649 |
| `INTERNED_ELEMENT_EQ` for `args` (`id` / `===`) | `ty/context.ts` | pointer hash/eq of `GenericArg` | → 605 |
| `hash_slice` / `slice_eq` written out per element type (monomorphic loops); `GenericArg::as_region/as_type/as_const` by `instanceof` | `sharded.ts`, `ty/context.ts`, `generic_args.ts` | `kind()` is free there | → 600 |
| `TypeVariableStorage` keeps its last `with_log`, `eq_relations()`, `sub_unification_table()` view per undo-log object | `type_variable.ts` | borrows, free | → 547 |
| `KeyedMap.replace`; `register` does one key computation | `keyed.ts`, `opaque_types/table.ts` | `get_mut` then `insert` | → 539 |
| `entries_of`: the opaque storage's copies through `Map.prototype.forEach` (a spread of the `Map` subclass took JSC's generic iteration) | `opaque_types/table.ts` | iterators | → 521 |
| `ElementPool`: `share_elements`' representatives in an open-addressing table, not `Map<hash, array>` | `sharded.ts` | n/a (port-only sharing) | |
| `key_OpaqueTypeKey` is `def_id * 2^32 + args.id` while exact (`def_id < 2^21`, `args.id < 2^32`), else `"def_id:args"` | `opaque_types/table.ts` | as above | → 512 |

**Why none can show in output, and what fails if one were wrong.** I ran every change wrong (mutation runs in a separate worktree at
HEAD, the file restored after each): **21 of 21 mutations fail a unit test or hang it**.

| change | why it cannot show | mutation → failing test |
|---|---|---|
| `CANONICAL_VAR_KIND_EQ` | `eq` is `value_eq` on every `CanonicalVarKind`: variant, then each field; `u32` indices by `===`; `PhantomData` skipped as `value_eq` skips `undefined`; a bound var's kind by identity, else `value_eq`; an unlisted variant goes to `value_eq`/`value_hash` whole. The hash only picks a bucket; the table uses one hash for all its lists (`elements_eq` panics after the first list) | ignore `sub_root`, the kind, the universe; hash `Anon` by identity only; slice loop from 1 → `element_eq.test.ts` "CANONICAL_VAR_KIND_EQ is value_eq ..." |
| `PREDEFINED_OPAQUE_EQ`, `INTERNED_ELEMENT_EQ` | the fields are a `u32` and interned objects, unique per id, so `===` is `value_eq` | ignore `def_id`, ignore `ty`, hash `id + 1` → the matching `element_eq.test.ts` test |
| the table's use of `slice_eq` | a hit is decided by `slice_eq`, as before by `value_eq` | always-hit → "a table decides a hit with its ElementEq's slice_eq" (a one-bucket table) |
| `ElementPool` | representatives are pairwise unequal, so at most one matches; `eq` decides | drop the hash compare → two table tests; grow without installing the new arrays → the pool test hangs (killed at 90 s) |
| `key_OpaqueTypeKey` | injective: quotient and remainder by 2^32 inside the bound, text with a separator outside it; numbers and strings never equal | pack by 2^31, widen the bound to 2^22, drop the separator → "key_OpaqueTypeKey: two keys give one text exactly when intern_key gives them one" |
| kept views | the views are references only: no field of theirs is written, and the storages and arrays behind them are never replaced (grep: no assignment to `.values`, `.eq_relations`, `.sub_unification_table`, `.undo_log`, `type_variable_storage`); given out only for the same log object; a clone is a new storage | ignore the log (table or eq view) → `type_variable_views.test.ts` |
| `KeyedMap.replace`, `register` | the same map operations and the same undo-log entry; a hidden type is never `undefined` | return the new value → `opaque_snapshot.test.ts` rollback + "keyed by value"; log no prev → rollback test |
| `entries_of` | the same entries, order and objects as the spreads | skip off by one, drop duplicates → `opaque_snapshot.test.ts` |
| `as_region/as_type/as_const` | `kind()`'s arms in its test order | wrong class → "GenericArg::as_region / as_type / as_const are kind()'s arms" |

**A self-check on real compilations** (scratch, not in the tree): every `intern_value`/`intern_slice` result against a shadow table on the reference
`intern_key`, in both directions (one object per key: no duplicate; one key per object: no merge). 0 duplicates and 0 merges in 136M checks:
the three cases (35.4M each), `hkl_forbidden.rs` 15.0M, `param_mismatch2.rs` 8.7M, `many-closures.rs` 1.6M, `deep-try-chain-issue-153583.rs` 0.3M,
`self-referential-4.rs` 9.7M. The tree's own corpus check (`intern_key.test.ts`) checks only the first direction.

## Correctness

On head's code (`18db5a74`; `e83ed052` changes tests only), `RUST_TS_AGENT=perf-tait`, `--sample 200 --jobs 5`, at load 6-26:

| suite | MATCH | other |
|---|---|---|
| `mir` | 200/200 | 0 |
| `mir-o2` | 200/200 | 0 |
| `mir-opt-o4` | 200/200 | 0 |
| `check-ui` | 200/200 (and 400/400 beside the timing, seed `perf-tait-beside`) | 0 |
| `mono-ui` | 200/200 | 0 |
| `expanded` | 200/200 | 0 |
| `tydump-ui` | 200/200 | 0 |
| `rmeta-ui` | 200/200 | 0 |
| `run-pass-miri` | 200/200 | 0 |

- **`rmeta-core`**, alone: 82,338/82,338 MATCH, 81 s wall, 129.8 s user, max RSS 9,347 MB (budget 12,288; the last gate read 9,707 on base).
- **`bun scripts/frozen-lists.ts`**: 48/48 protected cases MATCH with `RUST_TS_FREEZE_LISTS=1`. Also `recursive-drop-elaboration-2.rs` with lists
  frozen: same output, 42 s, 838 Ginstr.
- **Hello** (`fn main() { println!("Hello, world!"); }`, `-Zunpretty=mir`, std), main and head from `t3-perfbase` and `t3-1663f9e4` (equal length),
  alternated: base 11.95, 11.55, 11.56 G; head 11.82, 11.58, 11.60 G. Same output. No change.
- `bun test` on `rustc_data_structures`, `rustc_middle`, `rustc_infer`, `vendor/ena`, `rust_ts/intern_key.test.ts`, `rust_ts/keyed`,
  `rustc_next_trait_solver`, `rustc_trait_selection`, `rustc_type_ir`: 1,048 pass, 0 fail (before the last test commit; the two new files pass after it).
- `bunx tsc --noEmit -p .` clean; `coverage.ts --check` ok (24,893 markers). Coverage unchanged: `ty/context.rs` 202/202, `generic_args.rs` 60/60,
  `opaque_types/table.rs` 14/14, `type_variable.rs` 37/37, `sharded.rs` 8/23 (as on base; a partial port by design).
- **Unit time added:** `element_eq.test.ts` 0.16 s, `type_variable_views.test.ts` 0.22 s.

Not run: the gate, full suites other than `rmeta-core`, the alias sweep (no MIR pass touched).

## What remains

6.6x the oracle in instructions, spread thin: no function above 7%. The top is ena's `SnapshotVec::get` (6.7%, largely memory: the `VarValue` arrays),
`get_or_insert_bound_var` (6.4%, the same lookup table as upstream past 16 variables), the canonicalizer's `fold_region` (5.2%, three allocations per
region for a `CanonicalVarKind` upstream builds on the stack, discarded when the variable exists), `GenericArg::fold_with` (4.9%), `intern_slice` (4.4%,
now the typed loops over lists upstream also hashes and compares). That is the runtime's constant factor on upstream's algorithm. Candidates I left:
- `GenericArg::kind()` still allocates in `is_identity_modulo_regions` and `compute_query_response_instantiation_values_in_universe` (2.2% between them);
  the `instanceof` pattern of `fold_with` would remove it.
- The `hashed` maps of the interners (`Map<number, K>`) could take `ElementPool`'s open addressing.

## For review (PORTING's PORT(perf) rule asks for adversarial review)

1. **`key_OpaqueTypeKey`'s number form** is a packed key, the kind review has caught twice. Bound: `def_id < 2^21` and `args.id < 2^32`, product
   below 2^53; text otherwise. Tested at both bounds and on a text-form collision without the separator.
2. **The kept views.** The argument is "no field of a view is ever written, nothing behind it is replaced". A future change that assigns
   `storage.eq_relations = ...` or `SnapshotVec.values = ...` would make a kept view stale. The comment on `#table` says so.
3. **`CANONICAL_VAR_KIND_EQ`** compares `u32` fields with `===`, where `value_eq` tells `0` from `-0`. No index is `-0`.
4. `share_elements(element_eq)` and `elements_eq` must run before the table's first list (they panic otherwise), which `CtxtInterners::new` does.

## Files touched

`src/rustc_data_structures/sharded.ts`, `src/rustc_middle/ty/context.ts`, `src/rustc_middle/ty/generic_args.ts`,
`src/rustc_infer/infer/opaque_types/table.ts`, `src/rustc_infer/infer/type_variable.ts`, `src/rust_ts/keyed.ts`, new
`src/rustc_middle/ty/element_eq.test.ts` and `src/rustc_infer/infer/type_variable_views.test.ts`, this file.

`unported(...)` left: none. `// PORT:` decisions: only the `// PORT(perf):` comments listed above.
Scratch aids (session scratchpad, not in the tree): a CPU-profile aggregator with caller/callee views, the interning counter, the bidirectional shadow
runner, the mutation script.

**Note for root:** `frozen-lists.ts`'s header still says the heavy next-solver `mir` cases are near the limit (w40d audit N2). With lists frozen,
`-2.rs` now takes 42 s, so these three are no longer near-limit even frozen; root may want to revisit that header in a harness batch.
