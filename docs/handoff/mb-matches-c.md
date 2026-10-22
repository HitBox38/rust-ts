# Handoff: mb-matches-c (M4 wave 22, MIR build fill lane): builder/matches/{test, match_pair, buckets, user_ty, util}.rs

Branch `lane/mb-matches-c` (from `7d76ddd0`, no merges). Commits: the port + unit tests, then this handoff.

## Result
All 31 stubs of the lane are ported, in upstream order, with upstream comments; no `unported(..)` left in these files.

| upstream (compiler/rustc_mir_build/src/builder/matches/) | coverage |
|---|---|
| test.rs | 6/6 |
| match_pair.rs | 5/5 |
| buckets.rs | 2/2 |
| user_ty.rs | 9/9 |
| util.rs | 9/9 |

## Files touched
- `src/rustc_mir_build/builder/matches/{test,match_pair,buckets,user_ty,util}.ts` (the port).
- `src/rustc_mir_build/builder/contract.test.ts`: markers 50 → 81, stubs 263 → 232, `mb-matches-c` dropped from the
  per-lane table (0 left). The `construct_fn` stop (`scope::Builder::in_scope`, mb-scope) does not move.
- `src/rustc_mir_build/builder/matches/matches_c.test.ts` (new, 6 tests, see "Unit tests").

## Decisions (`// PORT:`; please record)
1. **`FxIndexMap<TestBranch, _>` and `FxIndexMap<Place, _>` are `KeyedMap`s keyed by `intern_key`** (rust_ts/intern_key.ts;
   the derived `Eq`: interned `ValTree` / `Ty` / projection lists by identity, the rest by value). Used for
   `PartitionedCandidates.target_candidates` (buckets.ts) and `FakeBorrowCollector.fake_borrows` (util.ts). matches/mod.rs has
   no `key_TestBranch`; if mb-matches-a/-b add one it must agree with `intern_key` (or replace it here).
   **Callers must pass `KeyedMap`s**: `perform_test(.., target_blocks)` looks up fresh `TestBranch` values
   (`target_blocks.get({ $: "Variant", _0: idx })`), so `test_candidates` (mb-matches-b) must build `target_blocks` as a
   `KeyedMap<TestBranch, BasicBlock>(intern_key)`; a plain `Map` would silently miss every entry.
2. `Place ==` (`choose_bucket_for_candidate`, the `Deref` temp comparison): a local `place_eq` (`local` by value, the
   interned `projection` list by identity). `ty::Value ==`: `ty` and `valtree` by identity. `Arc<PatRange> ==` (Range vs Range):
   `intern_key_eq` (derived `PartialEq` by value).
3. `partition_candidates_into_buckets`: `candidates: &mut [&mut Candidate]` is the array; `remaining_candidates` is
   `candidates.slice(k)` (the same `Candidate` objects, after the bucketed ones).
4. `assert!(cond, fmt..)` with a formatted message is `if (!cond) panic(msg)` so the message (Debug of candidates / types)
   is built only on failure, as in Rust (an eager `assert(cond, msg)` formatted spans on every call and needed session
   globals).
5. `Arc::clone(range)` shares the `PatRange` object (`TestableCase::Range` → `TestKind::Range`).
6. Signature change in an own declaration: `ProjectedUserTypesNode.iter_ops_reversed` returns `Generator<ProjectedUserTypesOp>`
   (was `Iterable`), the `impl Iterator` of upstream.
7. `annotation.clone()` of `CanonicalUserTypeAnnotation` (match_pair.rs `lower_thir_pat`) is the field copy the generated
   `clone_Ascription` uses (no `clone_CanonicalUserTypeAnnotation` exists).

## Stops these files reach (other lanes' stubs, at base `7d76ddd0`)
- mb-expr-a (expr/as_place.rs): `PlaceBuilder::{resolve_upvar, base, projection, project, clone_project, try_to_place, field,
  deref, downcast}`, `From<Place> for PlaceBuilder`, `Builder::len_of_slice_or_array`.
- mb-mod (misc.rs): `temp`, `literal_operand`, `push_usize`.
- mb-scope (scope.rs): `diverge_from` (`string_compare`).
- mb-matches-a (matches/mod.rs): `Candidate::sort_match_pairs` (every fully matched bucket), `TestableCase::as_range`,
  `TestBranch::as_constant` (`SwitchInt` bucketing).
- Callers of these files are mb-matches-a/-b (`Candidate::new` → `FlatPat::new`, `test_candidates` →
  `pick_test_for_match_pair` / `partition_candidates_into_buckets` / `perform_test`, `lower_match_tree` →
  `collect_fake_borrows`, `false_edges`, `visit_primary_bindings_special` → `ProjectedUserTypesNode`).

## Unit tests (`matches_c.test.ts`; end to end is not reachable: `construct_fn` stops in scope.rs)
- user_ty: projections built in push order from a shared parent chain (`Index`, `Subslice`, `Deref`, `Field`,
  `Downcast` + `Field`), empty chains stay empty, `push_user_types([])` panics.
- test.rs: `pick_test_for_match_pair` for every `TestableCase` (range shared), or-pairs ICE.
- match_pair.rs: `from_inter_pat` / `squash_inter_pat`: irrefutable nodes flattened, refutable subpatterns become subpairs,
  bindings after their subpatterns, ascriptions in visit order, `FromOrPattern` only for or-patterns with bindings.
- buckets.rs: all 9 slice-length arms + the catch-all, no pair on the tested place, partition stops at the first
  unbucketed candidate (buckets found by fresh `TestBranch` keys), the "at least the first candidate" assert message
  (`{total}, {candidates:#?}`); a fully matched pair is spliced and replaced by its sub-pairs (passes whether or not
  `sort_match_pairs` has landed: until then it stops there, after the splice).
- util.rs: `false_edges` (FalseEdge vs Goto on a real `CFG`), `ref_pat_borrow_kind`, `FakeBorrowCollector` (Shallow for
  switched places and their subpairs, Deep for deref-pattern places without visiting their subpairs, no downgrade,
  bindings outside the scrutinee base skipped).
- Not unit-tested (need other lanes' stubs): `perform_test`, `call_deref`, `compare`, `string_compare`, `lower_thir_pat`,
  `prefix_slice_suffix`, `collect_fake_borrows` with guards, `trait_method` (needs a crate with the lang items).

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok (19026; vendor 4196).
- `bun test src/rustc_mir_build`: 13 pass, 0 fail.
- Full `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000` (`RUST_TS_AGENT=mb-matches-c`): 5784 pass, 1 skip, 0 fail
  (398 files, 3277 s). Two earlier attempts were killed mid-run from outside (the shared-machine kills root warned about) and
  were rerun; no test failed in any attempt.

## Samples (`RUST_TS_AGENT=root-ad4b`, compared case by case, status and stop, against root's base runs)
| suite | lane run | M / D / U | base run | per case |
|---|---|---|---|---|
| tydump-minicore | `20261022-104742-root-ad4b-fpjb` | 45 / 0 / 1 | `20261022-101651-root-ad4b-9r7y` | 46/46 same |
| mirdump-minicore | `20261022-104830-root-ad4b-uopx` | 10 / 0 / 36 | `20261022-101711-root-ad4b-xljd` | 46/46 same |
| tydump-ui `--sample 300` | `20261022-104927-root-ad4b-fjjq` | 263 / 0 / 36 (+1 unstable) | `20261022-101731-root-ad4b-hqwm` | 300/300 same |
| hir-tree `--sample 200` | `20261022-105232-root-ad4b-uzpu` | 200 / 0 / 0 | — | 0 DIFF |

No new DIFF; no case changes (MIR building does not reach matches/ yet).
