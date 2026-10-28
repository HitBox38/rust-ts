# Handoff: bck-diag-c (M4 wave 25 borrowck diagnostics fill)

Branch `lane/bck-diag-c` (base `de448071` on integ-w19, no merges). Filled all 37 stubs of the bck-diag-c row of the
borrowck-contract split table: upstream `compiler/rustc_borrowck/src/diagnostics/{mutability_errors, var_name, find_use,
find_all_local_uses}.rs`.

Commits: `3688d854` (var_name, find_use, find_all_local_uses), `358e178b` (mutability_errors + contract counts),
`adc39daa` (mutability_errors header PORT notes, comments only), then this handoff.

## Files touched
- `src/rustc_borrowck/diagnostics/mutability_errors.ts`: every fn in upstream order. `report_mutability_error` covers
  every arm of both `match the_place_err` blocks and of `match error_access` (with the buffered-mut-error path, which
  collects the second and later mutable-borrow attempts). The suggestion helpers are `suggest_map_index_mut_alternatives`
  (the `.insert()` / entry API / `.get_mut()` multipart suggestions), `is_error_in_trait`,
  `construct_mut_suggestion_for_local_binding_patterns` (the `&(mut x)` case), `show_mutating_upvar`,
  `suggest_similar_mut_method_for_for_loop`, `point_at_binding_outside_closure`, `expected_fn_found_fn_mut_call`,
  `suggest_using_iter_mut`, `suggest_make_local_mut` (including the Clone / `suggest_derive` branch),
  `is_closure_arg_with_non_locally_decided_type` and `BindingFinder`. The free fns are `find_assignments`,
  `mut_borrow_of_mutable_ref`, `suggest_ampmut_self`, `suggest_ampmut` (including the `Index`-without-`IndexMut` /
  `get_mut` path), `is_closure_like`, `get_mut_span_in_struct_field` and `suggest_ref_mut`. Every message string is copied
  verbatim from upstream. Upstream builds these with direct `Diag` calls, not fluent slugs. The only session diagnostic
  is `CaptureVarCause::MutableBorrowUsePlaceClosure`, built through `UseSpans.var_subdiag`.
- `src/rustc_borrowck/diagnostics/var_name.ts`: the 6 `RegionInferenceContext` methods and `body_uses_local`.
- `src/rustc_borrowck/diagnostics/find_use.ts`: `find`, `UseFinder::find`, `DefUseVisitor::visit_local`.
- `src/rustc_borrowck/diagnostics/find_all_local_uses.ts`: `find`, `AllLocalUsesVisitor::visit_local`.
- `src/rustc_borrowck/contract.test.ts`, deltas only (root merges by delta): markers `458 -> 495` (+37), stubs
  `443 -> 406` (-37). The `bck-diag-c` row went 37 -> 0 and is now a comment.

The fn-local items are back inside their fns, as upstream has them: `FindLocalAssignmentVisitor` in `find_assignments`,
`SuggestIndexOperatorAlternativeVisitor` (with its nested `count_ty_refs` / `strip_n_refs`) in
`suggest_map_index_mut_alternatives`, and `Finder` in `suggest_similar_mut_method_for_for_loop`. `BindingFinder` stays
at module level and exported (upstream it is a module-level struct). `Finder` and `BindingFinder` now set
`override Result = VisitorResult.ControlFlow<..>()`, which the contract skeleton was missing.

## Coverage
`bun scripts/coverage.ts --missing`: mutability_errors.rs **25/25**, var_name.rs **7/7**, find_use.rs **3/3**,
find_all_local_uses.rs **2/2**. `bun scripts/coverage.ts --check`: markers ok (21334; vendor 4330).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun test src/rustc_borrowck`: **37 pass, 0 fail** (5 files).
- I skipped the full unit suite, as the coordinator instructed (root runs it at integration).
- No direct unit test for this lane. `report_mutability_error` immediately calls bck-diag-d / bck-diag-f builders that
  are still stubs (`describe_any_place`, `local_name`, `borrow_spans`, `cannot_assign`,
  `cannot_borrow_path_as_mutable_because`, `buffer_error`, ...). So a bck_lib_b-style test would only record those stops.
  It becomes testable end to end once those lanes land.

## Samples (`RUST_TS_AGENT=root-f5de`, same samples as the base runs in w25-common.txt)
| suite | lane run(s) | M / D / U / C / T / UNSTABLE | base run | M / D / U / C / T / UNSTABLE |
|---|---|---|---|---|
| tydump-minicore (46) | `20261027-225822-root-f5de-k0wj` | 46 / 0 / 0 / 0 / 0 / 0 | `20261022-210451-root-f5de-wos5` | 45 / 0 / 1 / 0 / 0 / 0 |
| mirdump-minicore (46) | `20261027-230046-root-f5de-kqtz` + re-run of the 2 TIMEOUTs alone (`--filter mini_core --jobs 1`) | 45 / 0 / 1 / 0 / 0 / 0 | `20261022-210534-root-f5de-p8q4` | 45 / 0 / 1 / 0 / 0 / 0 |
| tydump-ui `--sample 300` | `20261028-000624-root-f5de-r644` (`--jobs 4 --batch-size 5`) + 2 TIMEOUTs re-run alone (`-7p2v`, `-sh6k`: both MATCH) | 262 / 0 / 36 / 0 / 0 / 2 | `20261022-210624-root-f5de-zjq3` | 261 / 0 / 37 / 0 / 0 / 2 |
| mirdump-ui `--sample 300` | `20261028-002551-root-f5de-faxc` (`--jobs 4 --batch-size 5`) | 273 / 0 / 27 / 0 / 0 / 0 | `20261022-211125-root-f5de-mzgb` | 269 / 0 / 31 / 0 / 0 / 0 |
| borrowck-ui `--sample 300` | `20261028-003119-root-f5de-zgon` (`--jobs 4 --batch-size 5`) | 0 / 0 / 300 / 0 / 0 / 0 | `20261022-211729-root-f5de-86qn` | 0 / 0 / 300 / 0 / 0 / 0 |

I compared every case against its base run. **No MATCH turned into anything else, and there is no new DIFF, CRASH or
TIMEOUT.**
- The first pass (`-k0wj`, `-kqtz`, `-vqr1`, `-01pz`, `-xkcn`) ran at load average ~275-390 on 12 cores, with other
  lanes running. It had 2 / 93 / 235 / 33 TIMEOUTs in mirdump-minicore / tydump-ui / mirdump-ui / borrowck-ui, and
  nothing else changed except UNPORTED -> MATCH.
- Re-runs with small batches (and the remaining cases alone) cleared every TIMEOUT. Each re-run case came back with its
  base status or better.
- The gains are all UNPORTED -> MATCH: `mini_core_hello_world.rs` (tydump-minicore), `wrapping_niche.rs` (tydump-ui),
  and `option_with_bigger_niche_break.rs`, `issue-76248.rs`, `ice-issue-77564.rs`, `mir_refs_correct.rs` (mirdump-ui).
  They come from the newer base tree, not this lane: no case reaches this lane's code.

## Runtime stops
Unchanged by this lane. Every `mir_borrowck` body still stops in type_check or earlier.
- borrowck-ui sample: 187 `rustc_borrowck::diagnostics::bound_region_errors::UniverseInfo::relate` (bck-diag-f), 65
  `rustc_borrowck::constraints::OutlivesConstraintSet::push` (bck-regions-b), 10 `polonius_engine::AllFacts::default`, 5
  metadata `Decodable for mir::Body`.
- No stop in any suite is in this lane's modules.

Once the path gets this far, this lane's code calls these other lanes' stubs:
- **bck-diag-d** (diagnostics/mod.rs): `describe_any_place`, `describe_place`, `local_name`, `borrowed_content_source`,
  `BorrowedContentSource::describe_for_immutable_place`, `borrow_spans`, `UseSpans::args_or_use`, `UseSpans::var_subdiag`,
  `get_buffered_mut_error`, `buffer_mut_error`, `buffer_error`.
- **bck-diag-f** (borrowck_errors.rs): `cannot_assign`, `cannot_borrow_path_as_mutable_because`.
- **bck-diag-a**: `find_expr` (conflict_errors.rs:2322).
- **bck-diag-e**: `mir_def_id`, `mir_hir_id` (region_name.rs).

Callers of this lane's code: bck-lib-b's `check_access_permissions` calls `report_mutability_error`. bck-diag-e's
region_errors / region_name call the var_name methods. bck-diag-f's `explain_why_borrow_contains_point` calls
`find_use::find`. bck-diag-b's conflict_errors.rs:2269 calls `find_all_local_uses::find`, which returns a `Set<Location>`
already in `BTreeSet` order. All signatures are as declared by the contract; none changed.

## `unported(...)` left
None in this lane's files.

## `// PORT:` decisions
- mutability_errors.ts header:
  - `debug!` / `trace!` / `debug_assert!` are kept as comments.
  - Display formatting is `display_Ty` / `Symbol.as_str` / `display_Ident`.
  - Slice patterns over `PlaceRef::projection` are length / last-element checks in upstream arm order, guards included.
    The two `[PhantomDeref]` arms are kept separately.
  - Pure lazy iterator chains are collected eagerly (`peek().is_some()` = non-empty).
  - The fn-local items are inside their fns.
  - Query values typed `unknown` by queries.gen.ts are cast to their upstream types: `typeck` -> `TypeckResults`,
    `associated_items` -> `AssocItems`, `fn_sig` -> `EarlyBinder<PolyFnSig>`, `clauses_of` -> `GenericClauses`.
  - ty/closure.ts's `CAPTURE_STRUCT_LOCAL` has its own `Local` brand, so it is compared as a number.
  - `expect` / `unwrap` / `checked_sub(..).expect(..)` panic with core's / upstream's text.
- mutability_errors.ts: a module-level `fold_TraitRef` table (for `Binder::dummy`), as hir_typeck does.
- mutability_errors.ts: `fn_ident_and_sig` is the `Item::Fn | TraitItem::Fn | ImplItem::Fn` or-pattern that
  `expected_fn_found_fn_mut_call` uses twice.
- var_name.ts: `upvar_ty` in `get_upvar_index_for_region` is only read by a `debug!`, so it is not computed.
- find_use.ts: `VecDeque` is an array with a read cursor, and `FxIndexSet<Location>` is a `KeyedSet` (`Location_key` from
  borrow_set.ts).
- find_all_local_uses.ts: `BTreeSet<Location>` is a `KeyedSet<Location>`, and `find` returns it sorted by `Location`'s
  derived `Ord`. `visit_body` reaches var-debug-info places after the blocks, so insertion order is not key order.

## For root / other lanes
- Root: merge `contract.test.ts` by deltas (+37 markers, -37 stubs, bck-diag-c row -> comment). No stop pins moved.
- No shared files were edited outside the four lane files and the contract count test.
