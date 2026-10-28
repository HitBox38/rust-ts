# Handoff: mt-cleanup (M4 wave 24: the MIR cleanup passes)

Branch `lane/mt-cleanup` (from `f0e9a0cf`, no merges). Commits: `2c462f80` cleanup_post_borrowck.rs (done first: it was
a live stop), `59cc052f` the other 14 files, then this handoff.

## Result
Each stub module was replaced by the whole port: every fn, in upstream order, with markers. All files are in
`src/rustc_mir_transform/`:

| upstream (compiler/rustc_mir_transform/src/) | fns |
|---|---|
| cleanup_post_borrowck.rs | 2/2 |
| remove_noop_landing_pads.rs | 5/5 |
| deref_separator.rs | 5/5 |
| remove_uninit_drops.rs | 4/4 |
| add_call_guards.rs | 3/3 |
| post_analysis_normalize.rs | 7/7 |
| add_subtyping_projections.rs | 4/4 |
| abort_unwinding_calls.rs | 2/2 |
| add_moves_for_packed_drops.rs | 3/3 |
| erase_deref_temps.rs | 5/5 |
| elaborate_box_derefs.rs | 5/5 |
| lower_intrinsics.rs | 2/2 |
| remove_place_mention.rs | 2/2 |
| ctfe_limit.rs | 3/3 |
| mentioned_items.rs | 4/4 |
| impossible_clauses.rs | 5/5 (already ported by merge-w22, untouched) |

- `coroutine/drop.ts` (mt-coroutine-b's file): its module-local `deref_finder` stand-in is gone. The file now imports
  `deref_finder` from `../deref_separator.ts`, which is the repointing that file's header asks the owning lane to do.
  The header comment was updated to match. Nothing else in that file changed.
- `pass_manager.test.ts`: the stub-module count went from 54 to 39 (−15).
- Coverage: rustc_mir_transform 345/1101; TOTAL 20713/25518. `bun scripts/coverage.ts --check`: markers ok.
- `bunx tsc --noEmit -p .`: clean. `bun test src/rustc_mir_transform` at `59cc052f`: 62 pass, 0 fail. As root asked,
  I did not run the full unit suite.

## Stops moved
- `rustc_mir_transform::cleanup_post_borrowck::CleanupPostBorrowck (pass not ported)` is gone. I checked by rerunning
  the affected cases with base code (`git checkout f0e9a0cf -- src/rustc_mir_transform`, then restored). All 6
  CleanupPostBorrowck stops in the samples now stop further along, at
  `rustc_mir_transform::elaborate_drops::ElaborateDrops (pass not ported)` (lane mt-drops). The bodies are tainted
  and go through the whole analysis-cleanup list and the first 3 runtime-lowering passes first. The 6 cases:
  - mirdump-ui: `tests/ui/unsafe/break-inside-unsafe-block-issue-128604.rs`
  - tydump-ui: `tests/ui/const-generics/adt_const_params/byte-string-u8-validation.rs`,
    `tests/ui/traits/const-traits/issue-102985.rs`, `tests/ui/traits/trait-predicate-with-escaping-bounds.rs`,
    `tests/ui/typeck/escaping_bound_vars.rs`, `tests/ui/typeck/for-in-const-eval.rs`
- **New runtime stop for root:** `ElaborateDrops (pass not ported)`. With elaborate_drops in place, the next stubs on
  this path are `StateTransform` (coroutine/mod, mt-coroutine-a; reached for every body, its `policy` included) and
  `KnownPanicsLint` (mt-kpl-ubchecks).
- The mirdump suites only print `mir_built` / `mir_promoted`, so these passes only reach their output through CTFE.
  No mirdump stop belonged to this lane except the one in break-inside-unsafe above.

## Oracle verification of the passes (`-Zdump-mir`, scratch, not committed)
The harness has no suite that dumps MIR after these passes, and borrowck still stops UNPORTED, so I used a scratch
check: `$RUST_TS_DATA/scratch/mt-cleanup/{cwrap.ts,cmp.sh,first.sh}`.
- **How it works.** `cwrap.ts` runs the real `src/rust_ts/mirdump.ts`. After its MIR_borrow_checking loop it calls
  `mir_drops_elaborated_and_const_checked` for every body owner, with these changes:
  - `tcx.mir_borrowck` is faked to `Ok(empty)`;
  - the stub passes `ElaborateDrops` / `StateTransform` are no-ops with policy `Required`;
  - `KnownPanicsLint` is a no-op.
- **What it compares.** It runs `-Zdump-mir=all`, and the oracle is the pinned nightly `rustc --emit=mir -Zdump-mir=all`.
  `cmp.sh` byte-compares every analysis/runtime-phase dump file (`2-*`, `3-*`) that both sides wrote. `first.sh`
  reports the first diverging dump per body, after normalising `allocN` ids. Alloc numbering depends on query order,
  which the wrapper changes.
- **Results:**

| input | files compared | equal (alloc ids normalized) | first diff per body |
|---|---|---|---|
| c2.rs: derefs, Box, packed drop, intrinsics, unwinding calls, matches, casts | 874 | 798 | only at `ElaborateDrops.after` (4 bodies with drops) |
| c2.rs `-Cpanic=abort` | 828 | 809 | only at `ElaborateDrops.after` (1 body) |
| c3.rs: 13 intrinsics, guards/fake borrows, ascriptions, unsizing, raw/nested derefs, packed refs, extern "C"/"C-unwind" | 1140 | 1140 | none |
| c3.rs `-Cpanic=abort` | 1080 | 1080 | none |
| compiler/rustc_codegen_cranelift/example/mini_core.rs (minicore argv) | 2992 | 2992 | none |

- **Coverage of that check.** Every pass before ElaborateDrops matches on every body. The passes after it
  (AbortUnwindingCalls, AddMovesForPackedDrops, EraseDerefTemps, ElaborateBoxDerefs, LowerIntrinsics,
  RemovePlaceMention) are verified only on bodies with no `Drop` terminators. Their input on bodies with drops depends
  on ElaborateDrops. So AddMovesForPackedDrops' real rewrite (a packed field drop) is not oracle-checked yet.
  Re-run `cmp.sh` once mt-drops lands. CtfeLimit and MentionedItems only run on `mir_for_ctfe` / `optimized_mir`:
  CtfeLimit matched on the 2 CTFE bodies of c1.rs, and MentionedItems writes no dump.

## Samples (lane at `59cc052f`, `RUST_TS_AGENT=root-f5de`, compared case by case with root's base runs)
| suite | lane run | M / D / U / UNSTABLE | base run | M / D / U / UNSTABLE | changes |
|---|---|---|---|---|---|
| tydump-minicore (46) | `mtc-s-tymc` | 45 / 0 / 1 / 0 | `wos5` | 45 / 0 / 1 / 0 | none |
| mirdump-minicore (46) | `mtc-s-mirmc` | 45 / 0 / 1 / 0 | `p8q4` | 45 / 0 / 1 / 0 | none |
| tydump-ui `--sample 300` | `mtc-s-tyui` | 261 / 0 / 37 / 2 | `zjq3` | 261 / 0 / 37 / 2 | stop messages only |
| mirdump-ui `--sample 300` | `mtc-s-mirui` | 271 / 0 / 29 / 0 | `mzgb` | 269 / 0 / 31 / 0 | 2 UNPORTED → MATCH |
| borrowck-ui `--sample 300` | `mtc-s-bck` | 0 / 0 / 300 / 0 | `86qn` | 0 / 0 / 300 / 0 | stop messages only |

- Totals: 0 DIFF, 0 CRASH, 0 TIMEOUT. No MATCH became anything else.
- The 2 new mirdump-ui MATCHes (`tests/ui/mir/issue-76248.rs`, `tests/ui/mir/mir-inlining/ice-issue-77564.rs`) come
  from the wave-23 merges in the base, not from this lane. Both already MATCH with f0e9a0cf's
  rustc_mir_transform.
- Top stops now:
  - mirdump-ui: 22 `UniverseInfo::relate`, 3 `Decodable for mir::Body`, 2 `try_to_bits_for_ty`,
    1 `Decodable for (ConstValue, Ty)`, 1 `ElaborateDrops`;
  - borrowck-ui: 209 `UniverseInfo::relate`, 74 `OutlivesConstraintSet::push`, 12 polonius, 5 `Decodable for mir::Body`.

## `unported(...)` left
None in the 15 lane files.

## PORT decisions (phrased for `bun scripts/state.ts record decision`)
1. (mt-cleanup) MIR visitors in the cleanup passes (`DerefChecker`, `EraseDerefTempsVisitor`,
   `PostAnalysisNormalizeVisitor`, `SubTypeChecker`, `ElaborateBoxDerefVisitor`, `MentionedItemsVisitor`) extend
   mir/visit.ts's `MutVisitor` / `Visitor`; their `tcx` field is `tcx_`. `*place = ..` / `*rvalue = ..` use
   `replace_in_place`, and `place.local = ..` / `place.projection = ..` edit the visited object.
2. (mt-cleanup) erase_deref_temps: `**info = LocalInfo::Boring` stores a fresh `ClearCrossCrate::Set(Boring)` in
   `local_decl.local_info`, after `unwrap_crate_local`, so a `Clear` still ICEs as upstream.
3. (mt-cleanup) lower_intrinsics: `crate::take_array` is lib.ts's private fn, and pass modules must not import lib.ts
   (mt-skeleton init order). lower_intrinsics.ts has a module-local stand-in with the same body and no marker. Root
   may export lib.ts's `take_array` and repoint it through a lazy `require`.
4. (mt-cleanup) remove_noop_landing_pads: `RemoveNoopLandingPads.is_nop_landing_pad(..)` called on the unit value is a
   method called on `new RemoveNoopLandingPads()`.
5. (mt-cleanup) add_call_guards: the fn-local `enum Action` is a local tagged union. `u8::saturating_add(1)` clamps
   at 255. The chosen `&mut` target slot is a `MutRef<BasicBlock>` (`field_mut(kind, "target")` /
   `field_mut(targets, i)`).
6. (mt-cleanup) cleanup_post_borrowck: `body.user_type_annotations.raw.clear()` is `.length = 0`. Copies of `Copy`
   MIR objects (`SourceInfo`, `Place`, `UnwindAction`) put into new statements and terminators use `clone_*`
   (PORTING §8).

## For root / other lanes
- mt-drops: once `ElaborateDrops` lands, re-run `$RUST_TS_DATA/scratch/mt-cleanup/cmp.sh` on
  `scratch/mt-cleanup/c2.rs`. It currently stubs ElaborateDrops in `cwrap.ts`; drop that line. This checks the passes
  after drop elaboration on bodies with drops, packed-field drops in particular.
- `take_array` export (PORT decision 3).
- My stop-count delta for the contract tests: none touched. I edited only the `pass_manager.test.ts` stub count.
