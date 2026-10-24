# Handoff: bck-core (M4 wave 23, borrowck fill)

Branch `lane/bck-core` (from `e138140f` on integ-w19, no merges). Filled every stub of the bck-core row of the
borrowck-contract split table: upstream `compiler/rustc_borrowck/src/` borrow_set.rs, dataflow.rs, places_conflict.rs,
path_utils.rs, prefixes.rs, place_ext.rs, def_use.rs, used_muts.rs (64 fns).

## Files touched
- `src/rustc_borrowck/borrow_set.ts`: `BorrowSet::build` + accessors + `Index`, `BorrowData` accessors, `Display`,
  `LocalsStateAtExit::build` (with `HasStorageDead` moved back inside it), `GatherBorrows` (`insert_borrow(s)`,
  `gather_reborrows`, the `Visitor` impl). New exported helper `Location_key` (used by dataflow.ts).
- `src/rustc_borrowck/dataflow.ts`: `Borrowck` (the composed analysis), `JoinSemiLattice_BorrowckDomain.join`,
  `OutOfScopePrecomputer`, `calculate_borrows_out_of_scope_at_location`, `PoloniusOutOfScopePrecomputer` (ported: polonius
  next is the oracle's default, plan-m4 D7 §1c; `Borrows::new` takes it unless `-Zpolonius=off`/legacy), `Borrows`.
- `src/rustc_borrowck/places_conflict.ts`, `path_utils.ts`, `prefixes.ts`, `place_ext.ts`, `def_use.ts`, `used_muts.ts`.
- `src/rustc_borrowck/contract.test.ts`: split table row `bck-core` removed (0 stubs; a comment marks it), markers
  42 → **106** (+64), stubs 859 → **795** (−64). Other lanes edit the same numbers: merge by deltas.
- New `src/rustc_borrowck/bck_core.test.ts` (8 tests, see below).

## Coverage (`bun scripts/coverage.ts --missing compiler/rustc_borrowck/src/<f>.rs`)
borrow_set 24/24, dataflow 23/23, places_conflict 4/4, path_utils 4/4, prefixes 2/2, place_ext 1/1, def_use 1/1,
used_muts 5/5. `bun scripts/coverage.ts --check`: markers ok.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun test src/rustc_borrowck`: 14 pass (contract test 6 + bck_core 8).
- Dependent tests (`rustc_hir_typeck/contract`, `rustc_lint/late_c` + `late_e2` oracle tests, all of `rustc_hir_analysis`;
  `RUST_TS_AGENT=bck-core`): 266 pass, **12 fail, all pre-existing at the base `e138140f`**: the "end to end" cases of
  `src/rustc_hir_analysis/check/compare_impl_item.oracle.test.ts` still pin the stop `mir_borrowck provider (not
  ported)`; since the borrowck-contract merge it is `rustc_borrowck::nll::replace_regions_in_mir` (borrowck-contract
  re-pinned misc / late_c / late_e2 but missed this file). Not this lane's file: **root** (or the owner) should re-pin
  those 12 to `rustc_borrowck::nll::replace_regions_in_mir`. The full `bun test src` was not run (shared machine, load
  ~140); everything that loads rustc_borrowck was.
- The runtime path of `mir_borrowck` still stops at `rustc_borrowck::nll::replace_regions_in_mir` (bck-nll), before
  `BorrowSet::build`, so the contract test's stop is unchanged (no re-pin). The next stubs on the path after bck-nll's:
  `PoloniusLocationTable::new` (bck-nll), then **`BorrowSet::build` (done here)**, `type_check` (bck-tc-a), ...,
  `Borrows::new` (done here; it calls bck-regions-a's `RegionInferenceContext::first_non_contained_inclusive` under
  `-Zpolonius=off` and `RegionInferenceContextInner::is_loan_live_at` under next, both still stubs).
- `bck_core.test.ts` drives the lane's entry points on built MIR of a no_core crate (regions of `Rvalue::Ref` replaced
  by `ReVar`s, a stub `RegionInferenceContext` answering the two region queries from per-borrow live points):
  `BorrowSet::build` (shared, mut, two-phase with activation, local map; `LocalsStateAtExit` both ways and
  `ignore_borrow`), `places_conflict` / `borrow_conflicts_with_place` (field disjointness, shallow/deep/drop behind a
  `&mut` deref, array-length shallow access, fake shallow borrows), `prefixes` (All / Shallow), `is_active`,
  `each_borrow_involving_path`, `calculate_borrows_out_of_scope_at_location` and the polonius precomputer, `Borrows`
  statement effects / `kill_borrows_on_place` / `iterate_to_fixpoint` entry states, `gather_used_muts`, `categorize`.
  Expected values were derived by hand from upstream over the MIR (shown in the test).

## Sample difftests (`RUST_TS_AGENT=root-f5de`, same samples as root's base runs)
| suite | lane run | M / D / U / C / UNSTABLE | base run | M / D / U / C / UNSTABLE |
|---|---|---|---|---|
| tydump-minicore (46) | `20261022-205711-root-f5de-mpf3` | 45 / 0 / 1 / 0 / 0 | `20261022-175059-root-f5de-8kp6` | 45 / 0 / 1 / 0 / 0 |
| mirdump-minicore (46) | `20261022-205730-root-f5de-r12n` | 45 / 0 / 1 / 0 / 0 | `20261022-175111-root-f5de-bbue` | 17 / 0 / 29 / 0 / 0 |
| tydump-ui `--sample 300` | `20261022-205751-root-f5de-5dj9` | 261 / 0 / 37 / 0 / 2 | `20261022-175123-root-f5de-supl` | 258 / 0 / 40 / 0 / 2 |
| mirdump-ui `--sample 300` | `20261022-210124-root-f5de-dcsx` | 269 / 0 / 31 / 0 / 0 | `20261022-175248-root-f5de-c6id` | 17 / 0 / 283 / 0 / 0 |
| borrowck-ui `--sample 300` | `20261022-210635-root-f5de-gxw0` | 0 / 0 / 300 / 0 / 0 | (no root-f5de base) | |

Per-case comparison: **no MATCH lost, no DIFF / CRASH / TIMEOUT** in any suite. The gains and the changed stop messages
come from the newer base tree (`e138140f` vs root's `f5de3f15` runs: the borrowck contract, CTFE lanes, mir transforms),
not from this lane: every `mir_borrowck` stop is `rustc_borrowck::nll::replace_regions_in_mir` (tydump-ui 21, mirdump-ui
13, borrowck-ui 287; the rest of borrowck-ui is 13× `eval_in_interpreter`), which runs before any code of this lane.
borrowck-ui has no root-f5de base run; on this sample it has no MATCH that could be lost.

## `unported(...)` left
None in the lane's files.

## `// PORT:` decisions
- borrow_set.ts: `location_map` / `activation_map` / dataflow's `FxIndexMap<Location, Vec<BorrowIndex>>` are `KeyedMap`s
  keyed by `Location_key` (block * 2^32 + statement_index); `local_map` / `pending_activations` plain `Map`/`Set`
  (number keys); `.entry().or_default()` = get-or-insert. The derived `PartialEq`s used by `==` / `assert_eq!`
  (`Location`, `mir::Place` = same local + same interned projection list, `BorrowKind`, `TwoPhaseActivation`) are local
  helpers; `assert_eq!(.., "msg")` uses core's `assert_failed_inner` text with the message. The `bug!`s that print a
  `hash_map::OccupiedEntry` use std's Debug (`OccupiedEntry { key: .., value: .., .. }`). `IndexVec` / `HashMap` index
  panics use std's texts. `HasStorageDead` is fn-local again (inside `LocalsStateAtExit.build`).
- dataflow.ts: `kill_all` / `gen_` through `GenKill_MixedBitSet<BorrowIndex>()`; `.filter(..)` of
  `kill_borrows_on_place` is a lazy generator (`filter_iter`); `tcx.sess.opts.unstable_opts.polonius.is_next_enabled()`
  reads `config.Polonius` through `rustc_session/lib.ts` (config.ts is not a fresh entry point).
- places_conflict.ts / def_use.ts: the tuple / nested `match`es are if-chains in upstream arm order (def_use's
  `mu`/`nmu`/`nu` are module-level pattern helpers, no per-call closures; `categorize` runs per local use).
  `unimplemented!()` → `panic("not implemented")`.
- used_muts.ts: `IndexSet::swap_remove` is a local `index_set_swap_remove` (same as rustc_resolve/imports.ts's; a shared
  `src/rust_ts` home would be better, root's call); `used_mut.union(..).cloned().collect()` = `new Set([...a, ...b])`.
- path_utils.ts: `upvars[field.index()]` indexes by the branded `FieldIdx` directly.

## For other lanes / root
- bck-regions-a: `Borrows::new` needs `RegionInferenceContextInner::is_loan_live_at` (default polonius next) and
  `RegionInferenceContext::first_non_contained_inclusive` (`-Zpolonius=off`); `bck_core.test.ts`'s stub documents the
  contract they must satisfy (first point in `start..=end` not in the region / loan liveness at a location).
- Root: re-pin `compare_impl_item.oracle.test.ts`'s 12 end-to-end stops (see Checks).
- No shared files edited (only rustc_borrowck files of this row + the contract test's counts).
