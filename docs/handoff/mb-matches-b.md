# Handoff: mb-matches-b (M4 wave 22, MIR build fill lane): builder/matches/mod.rs lines 1500–3010

Branch `lane/mb-matches-b` (from `7d76ddd0`, no merges).

## Files touched
- `src/rustc_mir_build/builder/matches/mod.ts`: 19 of the lane's 21 stubs filled in place, in upstream order. Their value
  imports are in **one block right above `lower_match_tree`**, not in the header, so the header imports that
  mb-matches-a edits stay untouched (fewer merge conflicts). Names the header imports as types only are aliased
  (`SourceInfoC`, `LocalC`, `SpanC`, `TyC`). Root may move the block into the header after integration.
- `src/rustc_mir_build/builder/contract.test.ts`: counts only: markers 50 → 69, stubs 263 → 244, `mb-matches-b` 21 → 2.
  The other lanes change the same three lines, so expect trivial merge conflicts there.
- `src/rustc_mir_build/builder/matches/matches_b.test.ts` (new): unit tests (see below).

## Coverage
`bun scripts/coverage.ts --missing compiler/rustc_mir_build/src/builder/matches/mod.rs`: 19/49 ported. The lane's range is
19/21. The other 28 missing fns are mb-matches-a's (lines < 1500). `coverage.ts --check`: markers ok (19014; vendor 4196).

Ported: `lower_match_tree`, `match_candidates`, `match_candidates_inner`, `select_matched_candidate`,
`expand_and_match_or_candidates`, `create_or_subcandidates`, `merge_trivial_subcandidates`, `remove_never_subcandidates`,
`test_remaining_match_pairs_after_or`, `pick_test`, `test_candidates`, `lower_fallible_let`,
`bind_and_guard_matched_candidate`, `ascribe_types`, `bind_matched_candidate_for_guard`,
`bind_matched_candidate_for_arm_body`, `pin_borrowed_local`, `declare_binding`, `should_emit_debug_info_for_binding`.

## Left as stubs (`unported(...)`)
- `mod.rs:2883 static_pattern_match` and `mod.rs:2922 static_pattern_match_inner`
  (`rustc_mir_build::builder::matches::Builder::static_pattern_match[_inner]`). Both depend on rustc_pattern_analysis
  (`RustcPatCtxt::lower_pat`, `DeconstructedPat::ctor` / `iter_fields` / `ty`, `Constructor`, `IntRange`,
  `MaybeInfiniteInt`, `RangeEnd`). That crate does not exist in `src/` at this base (lanes pat-a/-b/-c), and the
  declarations type it as `unknown`. Porting against a guessed API would break "never guess". The only caller is the
  `loop_match` / `#[const_continue]` lowering in expr/into.rs. Fill them once rustc_pattern_analysis lands (same file,
  lines ≥ 1500).

## PORT decisions (please record)
1. `&mut [&mut Candidate]` is a `Candidate[]` of the shared candidate objects. Sub-slices (`[first, remaining @ ..]`,
   `split_at_mut`) are `slice()` copies, and `&mut [leaf_candidate]` is `[leaf_candidate]`. Mutations go through the
   objects, so this matches upstream.
2. `test_candidates`' `FxIndexMap<TestBranch, BasicBlock>` is a `KeyedMap<TestBranch, BasicBlock>(intern_key)`, following
   builder-contract decision 6. A `TestBranch` holds a `ty::Value` (interned `ty` / `valtree`) or a `VariantIdx`, so
   `intern_key` gives its derived `Eq`. `perform_test` (mb-matches-c) receives this map. If mb-matches-c settles on a
   dedicated `key_TestBranch`, switch to it (it must agree with `intern_key`).
3. `Place` / `SourceInfo` are `Copy`, so each is cloned where rustc copies it out of data that stays shared:
   - `Place`: `binding.source` in the `Ref` / `Use` rvalues, the fake-borrow place, `ascription.source`, `pick_test`'s
     `match_place` (copied out of the match pair), the second use of `pinned_temp` and of `value_for_arm`.
   - `SourceInfo`: each `LocalDecl.source_info` and each `VarDebugInfo.source_info` in `declare_binding`.

   This follows PORTING §8 and builder-contract decision 7. Sub-branch bindings / ascriptions may be shared between
   sub-branches through their parents' `PatternExtraData`.
4. `let [true_branch] = built_tree.branches.try_into().unwrap()` checks the length and panics with rustc's `unwrap` text
   (the `Err` value printed with `debug_vec(.., debug_MatchTreeBranch)`).
5. The `try { scrutinee_place = ..try_to_place(self)?; (Some(&scrutinee_place), scrutinee_span) }` block in
   `lower_fallible_let` is `scrutinee_place === undefined ? undefined : [scrutinee_place, scrutinee_span]`.
6. `Vec::remove(0)` is `splice(0, 1)[0]!`, `Vec::retain_mut` is `filter` (it visits elements in order, like upstream),
   and `mem::take` / `Option::take` are read-then-reset. `debug!` / `#[instrument]` / `debug_assert!` stay as comments.

## Where things stop now (unit tests, `matches_b.test.ts`)
End-to-end match lowering is not reachable: `construct_fn` stops at `scope::Builder::in_scope` (mb-scope). The test takes
the real `Builder` that `construct_fn` builds for `pub fn f(x: u8, y: bool) -> u8 { x }` (no_core) by temporarily replacing
`Builder.prototype.in_scope`, then checks:
- `match_candidates` on `[]` and on two fully matched candidates: pre-binding, otherwise and false-edge-start blocks
  chain in order. `select_matched_candidate` panics on an already matched candidate.
- `remove_never_subcandidates` keeps non-never subcandidates. `merge_trivial_subcandidates` gives up under a guard.
  Without a guard it stops at `PatternExtraData::is_empty` (mb-matches-a).
- `test_remaining_match_pairs_after_or` returns at once when no match pairs remain.
- `bind_and_guard_matched_candidate`:
  - On a never sub-branch, its block ends in `Unreachable` and it returns a fresh block.
  - Without a guard or bindings, it returns the success block unchanged.
- `declare_binding` with a guard creates:
  - the arm-body local (`Var` binding form, own `SourceInfo` copy);
  - the `&T` guard local (`RefForGuard`, immutable);
  - two debuginfo entries;
  - `var_indices` `ForGuard`, which `var_local_id` reads back.
- `should_emit_debug_info_for_binding` (including the `lhs` / `hir_parent_iter` path).
- `pin_borrowed_local` on a non-`Pin` local raises the span_bug.
- `pick_test` stops at `test::Builder::pick_test_for_match_pair` (mb-matches-c).

Stubs of other lanes on this lane's paths:
- mb-matches-a: `Candidate::new`, `from_flat_pat`, `visit_leaves[_rev]`, `starts_with_or_pattern`,
  `PatternExtraData::is_empty`, `MatchTreeBranch::from_candidate`, `lower_scrutinee`, `declare_bindings`, `bind_pattern`,
  `lower_if_condition`, `storage_live_binding`, `schedule_drop_for_binding`.
- mb-matches-c: `collect_fake_borrows`, `false_edges`, `ref_pat_borrow_kind`, `pick_test_for_match_pair`,
  `perform_test`, `partition_candidates_into_buckets`.
- mb-scope: `in_if_then_scope`, `break_from_if_then_scope`, `clear_match_arm_and_guard_scopes`.
- mb-mod: `consume_by_copy_or_move`, `visit_coverage_conditional_let`.
- mb-expr-a: `PlaceBuilder::base`, `try_to_place`.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun test src/rustc_mir_build` (`RUST_TS_AGENT=mb-matches-b`): 9 pass, 0 fail (contract.test.ts 3, matches_b.test.ts 2, the rest).
- Full `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000` (`RUST_TS_AGENT=mb-matches-b`, at `6a451771`): 5780 pass, 1 skip, 0 fail (3979 s under load; an earlier attempt was cut off by the 30-min background-task limit, not a test failure).

## Samples (`RUST_TS_AGENT=root-ad4b`, compared case by case, status + unported reason, against root's base runs)
| suite | lane run | M / D / U / C | base run | changed cases |
|---|---|---|---|---|
| tydump-minicore | `20261022-104053-root-ad4b-d2ng` | 45 / 0 / 1 / 0 | `…-101651-root-ad4b-9r7y` | 0 of 46 |
| mirdump-minicore | `20261022-104140-root-ad4b-ajeg` | 10 / 0 / 36 / 0 | `…-101711-root-ad4b-xljd` | 0 of 46 |
| tydump-ui `--sample 300` | `20261022-104225-root-ad4b-o4yd` | 263 / 0 / 36 / 0 (1 UNSTABLE) | `…-101731-root-ad4b-hqwm` | 0 of 300 |
| hir-tree `--sample 200` | `20261022-104650-root-ad4b-wskb` | 200 / 0 / 0 / 0 | (base: 0 DIFF) | — |

No change, as expected: mirdump stops before MIR building (check_unsafety / mir_keys / check_match, see builder-contract).
