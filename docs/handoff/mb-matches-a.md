# Handoff: mb-matches-a (M4 wave 22, MIR build fill lane): builder/matches/mod.rs lines 1-1499

Branch `lane/mb-matches-a` (from `7d76ddd0`, no merges).

## Result
- **All 28 stubs of the lane are ported** in `src/rustc_mir_build/builder/matches/mod.ts`, in place and in upstream order
  (`let_not_permitted`, `lower_if_condition`, `match_expr`, `lower_scrutinee`, `lower_match_arms`, `bind_pattern`,
  `expr_into_pattern`, `place_into_pattern`, `declare_bindings`, `declare_guard_bindings`, `storage_live_binding`,
  `schedule_drop_for_binding`, `visit_primary_bindings`, `visit_primary_bindings_special`, `PatternExtraData::is_empty`,
  `Candidate::{new, from_flat_pat, sort_match_pairs, starts_with_or_pattern, visit_leaves, visit_leaves_rev}`,
  `traverse_candidate`, `TestableCase::as_range`, `TestBranch::as_constant`, `MatchTreeSubBranch::from_sub_candidate`,
  `MatchTreeBranch::from_candidate`, `sub_branch_bindings`, `push_sub_branch_bindings`).
  mb-matches-b's stubs (lines >= 1500, below in the same file) are untouched; only the import block at the top changed.
- New unit tests `src/rustc_mir_build/builder/matches/mod_a.test.ts` (10 tests): the pure helpers, and `lower_if_condition`
  (`&&`, `||`, plain condition, `ValueExpr(Let)`), `declare_guard_bindings`, `visit_primary_bindings` on a builder whose
  collaborators (other lanes' stubs) are replaced on the instance.
- `src/rustc_mir_build/builder/contract.test.ts` re-pinned: markers 50 -> 78, stubs 263 -> 235, the `mb-matches-a` row is
  gone from the per-lane table (0 left). The line-1500 split check still runs (all remaining matches/mod.rs stubs are
  mb-matches-b's). The `construct_fn` stop is unchanged (`scope::Builder::in_scope`, mb-scope).

## Signature changes (declarations are root-owned after integration)
- `traverse_candidate<C extends Candidate, T, I extends Iterable<C>>` (was unconstrained `<C, T, I>`): the body reads
  `candidate.borrow().subcandidates` and iterates `get_children(..)`.
- `push_sub_branch_bindings(.., remainder: Iterator<readonly SubpatternBindings[]>)` (was `Iterable`): upstream's
  `&mut impl Iterator` is advanced by the callee and shared with the caller, so it must be one JS iterator.

## `// PORT:` decisions
- `Copy` classes (builder/mod.ts header, decision 7): a `Place` stored into a further MIR location gets its own copy
  (`clone_Place`): the fake read and the `AscribeUserType` of `expr_into_pattern`, `*match_place = Some(place)` per binding
  in `place_into_pattern`, `x.cloned()` in `declare_bindings`. The statement `SourceInfo` reused for the arm's `goto` in
  `lower_match_arms` is cloned. `*binding` in `push_sub_branch_bindings` is `clone_Binding`.
- `annotation.clone()` (`CanonicalUserTypeAnnotation`, no generated clone fn) is an object literal of its three fields, as
  codegen's `clone_Ascription` does.
- `lower_match_arms`: `arms.iter().map(..).zip(branches).map(..).collect()` is one loop over the shorter length.
- `bind_pattern`: `.into_iter().rev().with_position()` + `pos.is_last()` (`Last | Only`) is a reverse index loop with
  `is_last = (i === 0)`.
- `sort_match_pairs`: `sort_by_key(bool)` is `Array.prototype.sort` (stable) on `false=0 < true=1`.
- `visit_leaves_rev`: `iter_mut().rev()` is a small reverse generator (`rev`, module-private helper).
- `place_into_pattern`: `let [branch] = ..try_into().unwrap()` / `.first().unwrap()` panic with Rust's unwrap messages.
- `ty::tls::with(|tcx| tcx.dcx().delayed_bug(..))` is rustc_middle `context/tls.ts`'s `with_`.

## `unported(...)` left
None in this lane's range. Reached collaborators that are still stubs (other lanes): mb-scope (`in_scope`, `opt_in_scope`,
`in_if_then_scope`, `break_from_if_then_scope`, `local_scope`, `source_info`, `new_source_scope`, `schedule_drop_*`),
mb-matches-b (`lower_match_tree`, `lower_fallible_let`, `bind_and_guard_matched_candidate`, `declare_binding`), mb-matches-c
(`FlatPat::new`, `ProjectedUserTypesNode::*`), mb-expr-a/-b (`as_temp`, `as_place_builder`, `PlaceBuilder::try_to_place`,
`expr_into_dest`), mb-mod (`set_correct_source_scope_for_arg`, coverage `push_coverage_point_for_expr`,
`visit_coverage_branch_condition`, `visit_unary_not`).

## Stops reached
End to end nothing reaches this code yet: `construct_fn` stops at `scope::Builder::in_scope` (mb-scope) and the hook at
`check_match`; mirdump-minicore stops before MIR building (check_unsafety / mir_keys).

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok (19023; vendor 4196).
- `bun scripts/coverage.ts --missing compiler/rustc_mir_build/src/builder/matches/mod.rs`: only mb-matches-b's 21 fns
  (lines 1547..2922) left; lines 1-1499: 28/28.
- `bun test src/rustc_mir_build/builder`: 13 pass (contract 3, mod_a 10).
- Full `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000` (`RUST_TS_AGENT=mb-matches-a`, at `ed4e9b6a`): 5788 pass,
  1 skip, 0 fail (3863 s under load ~75). Two earlier attempts were killed mid-run by the shared machine (no failures
  before they died); the third completed.
- Note for root: while waiting on the first attempt I ran `pkill -f "until grep -q"` to stop my own wait loops. That
  pattern could also have matched other lanes' `until grep -q ..` wait loops (not their `bun test` processes). It was
  before the root notice; since then I only stop my own task ids.

## Samples (`RUST_TS_AGENT=root-ad4b`, compared per case with root's base runs: status and stop identical for every case)
| suite | lane run | M / D / U | base run | M / D / U |
|---|---|---|---|---|
| tydump-minicore | `20261022-103622-root-ad4b-1sor` | 45 / 0 / 1 | `20261022-101651-root-ad4b-9r7y` | 45 / 0 / 1 |
| mirdump-minicore | `20261022-103644-root-ad4b-ezh0` | 10 / 0 / 36 | `20261022-101711-root-ad4b-xljd` | 10 / 0 / 36 |
| tydump-ui `--sample 300` | `20261022-103706-root-ad4b-nync` | 263 / 0 / 36 (+1 unstable) | `20261022-101731-root-ad4b-hqwm` | 263 / 0 / 36 (+1 unstable) |
| hir-tree `--sample 200` | `20261022-104005-root-ad4b-k768` | 200 / 0 / 0 | (root: 0 DIFF) | |

No new DIFF.

## Shared files edited (review)
`src/rustc_mir_build/builder/contract.test.ts` (counts only). Expect a textual conflict there and in matches/mod.ts's
import block with mb-matches-b / other fill lanes (both edit the same lines); resolve by union.
