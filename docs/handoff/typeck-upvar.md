# Handoff: typeck-upvar (M3 wave 18b, rustc_hir_typeck upvar.rs)

Branch `lane/typeck-upvar` (from integ `a5910d3`, no merges). Commits: `44b338b` (port), `9ed8d8c` (tests), + this handoff.

## Result
- **compiler/rustc_hir_typeck/src/upvar.rs: 52/52** (`bun scripts/coverage.ts --missing compiler/rustc_hir_typeck/src/upvar.rs`
  -> `52/52 ported`; `--check`: `markers ok (15215; vendor 3888)`).
  - FnCtxt methods (19): `closure_analyze`, `infer_closure_kind_for_diagnostic`, `analyze_closure`,
    `coroutine_body_consumes_upvars`, `final_upvar_tys`, `process_collected_capture_information`, `compute_min_captures`,
    `perform_2229_migration_analysis`, `compute_2229_migrations_{reasons,for_trait,for_drop}`, `compute_2229_migrations`,
    `has_significant_drop_outside_of_captures`, `init_capture_kind_for_place`, `place_for_root_variable`,
    `should_log_capture_analysis`, `log_capture_analysis_first_pass`, `log_closure_min_capture_info`,
    `determine_capture_mutability`. The `unported_methods(..)` list of upvar.ts is gone.
  - Free fns (22): all bodies filled.
  - Hand classes (decls.ts "Representation" 7): `InferBorrowKindVisitor extends hir.intravisit.Visitor` (`visit_expr`,
    `visit_inline_const`), `InferBorrowKind implements Delegate` (`fake_read`, `consume`, `use_cloned`, `borrow`, `mutate`;
    `copy` / `bind` forward to `Delegate_provided`).
  - Nested items: `HasNestedClosure` (class inside `infer_closure_kind_for_diagnostic`, marker on `visit_expr` :108),
    `MigrationLint` (class implementing `Diagnostic` inside `perform_2229_migration_analysis`, marker on `into_diag`
    :1090), `is_field` (nested fn in the sort comparator, :1017). `MigrationWarningReason::migration_message` (:189) is the
    exported free fn `MigrationWarningReason_migration_message(self_)` (the generated class carries no methods).

## Files
- `src/rustc_hir_typeck/upvar.ts` (filled; was the stub).
- `src/rustc_hir_typeck/upvar.test.ts` (new, 11 tests).
- `docs/handoff/typeck-upvar.md` (this file).
No other file touched (decls.ts, contract.test.ts, upvar.gen.ts, tools unchanged).

## PORT decisions (please record)
1. **Pending rustc_middle hir/place.rs** (lane typeck-euv ports it in parallel). upvar.ts codes against decls.ts's
   `Pending` `Place` / `PlaceBase` / `Projection` / `PlaceWithHirId` through views at the end of the file (the
   closure.ts precedent): `pv(place)` -> `{ base_ty, base: HirPlaceBase, projections: {ty, kind: HirProjectionKind}[],
   deref_tys(): Iterable<Ty>, ty(), ty_before_projection(i) }`, `pvh(pwh)` -> `{ hir_id, place }`. The shapes assumed
   are the PORTING §5 ones and match rustc_middle ty/closure.ts's `HirPlaceBase` / `HirProjectionKind`:
   `PlaceBase` = `{$:"Rvalue"} | {$:"StaticItem"} | {$:"Local",_0:HirId} | {$:"Upvar",_0:UpvarId}`, `ProjectionKind` =
   `{$:"Deref"} | {$:"Field",_0:FieldIdx,_1:VariantIdx} | {$:"Index"} | ...`, `Place` a class with fields
   `base_ty, base, projections` (a mutable array: `truncate` / `clear` set `.length`) and the three methods.
   **Unported stand-ins for root to replace** when typeck-euv lands (all in the last section of upvar.ts):
   `Place_new(base_ty, base, projections)` (struct literal, upvar.rs:1923), `PlaceWithHirId_new(hir_id, place)`
   (:135), `clone_Place` (`.clone()`, derived), `fold_Place` (D4 `TypeFoldable` descriptor, derived; used by
   `FnCtxt::normalize`), `debug_PlaceBase` / `debug_ProjectionKind` / `debug_Projections` (only in `bug!` /
   `span_delayed_bug` messages). `PlaceBase_eq` / `ProjectionKind_eq` are the derived `PartialEq`s written against the
   views (replace by the generated ones if typeck-euv emits them). `as_HirPlace(p)` casts decls.ts `Place` to rustc_middle
   ty/decls.ts `HirPlace` (both are pending `hir::place::Place`; `TypeckResults.closure_kind_origins` /
   `closure_fake_reads` / `CapturedPlace.place` use the latter): drop the casts once both re-export the real type.
2. **`truncate_place_to_len_and_update_capture_kind`'s `curr_mode: &mut ty::UpvarCapture` is a `MutRef<UpvarCapture>`**
   (PORTING §8: overwritten as a whole). decls.ts `Fns_upvar` declares it by value (`curr_mode: UpvarCapture`), which
   cannot be written back. `// PORT(decls): pending root`: the export carries two overload signatures (the `MutRef` one
   used everywhere, plus the decls one so `Fns_upvar` / contract.test.ts keep type-checking; the implementation rejects a
   non-`MutRef` with `unreachable`). **Root: change `Fns_upvar.truncate_place_to_len_and_update_capture_kind` to
   `(place: Place, curr_mode: MutRef<UpvarCapture>, len: number): void`, then delete the second overload and the guard.**
   The by-value callers (`restrict_*`, `adjust_for_*`, `truncate_capture_for_optimization`) wrap their `mut` parameter
   in a local `MutRef`; `&mut x.info.capture_kind` is `field_mut(x.info, "capture_kind")`.
3. **`ty::CaptureInfo` is `Copy`**: every Rust copy that is mutated afterwards is `copy_CaptureInfo(..)`
   (`process_collected_capture_information`'s `.cloned()`, `updated_capture_info`, `determine_capture_info`'s result,
   which is always a fresh copy of the selected argument); `CapturedPlace::clone` is `clone_CapturedPlace` (local).
4. **Keyed collections**: `FxIndexMap<UpvarMigrationInfo, UnordSet<&str>>` / `FxIndexSet<UpvarMigrationInfo>` are
   `KeyedMap` / `KeyedSet` keyed by `intern_key` (derived `Hash`+`Eq`; they satisfy decls.ts's `Map` / `Set` types).
   `UnordSet<&'static str>` is `Set<string>`; `into_sorted_stable_ord` sorts by code point (`str_cmp`).
   `sort_by_cached_key` / `sort_by` are `Array.prototype.sort` (stable).
5. **Visitors / euv**: `FnCtxt::new(self, ..)` is `FnCtxt.new(this.root_ctxt, ..)`; `euv::ExprUseVisitor::new(&fcx, &mut
   delegate)` is `ExprUseVisitor.new(TypeInformationCtxt.of(fcx, TypeInformationCtxt_FnCtxt), delegate)`.
   `deeply_resolve_ignoring_regions(args)` on `UpvarArgs` uses a local D4 descriptor `fold_UpvarArgs` built from
   sty.gen.ts's derived fns.
6. **Misc**: `let closure_hir_id = ..` (shadowing the parameter, upvar.rs:418) is a reassignment; the
   `upvars_mentioned` query's key type in queries.gen.ts is rustc_lint_defs' `HirId` alias, cast to `HirId`;
   `closure_size_eval`'s value type is still `Pending` in typeck_results.ts (`data as never`); `str::trim_end` /
   `split_once(|c| !c.is_whitespace())` / `Iterator::skip` / `any` / `Vec::retain` are local helpers; `{:?}` of
   `FieldIdx` / `VariantIdx` in `construct_place_string` is the number, of `ty::BorrowKind` the variant name.

## `unported(...)` left
Only the hir/place.rs stand-ins of decision 1: `rustc_middle::hir::place::Place (hir/place.rs, lane typeck-euv)`,
`.. PlaceWithHirId ..`, `.. Place Clone ..`, `.. Place TypeVisitable/TypeFoldable ..`, `.. PlaceBase Debug ..`,
`.. ProjectionKind Debug ..`, `.. Projection Debug ..`. So today every closure with a capture stops at `clone_Place`
(first `InferBorrowKind` callback on an upvar) or `Place_new` (`place_for_root_variable`), after the other lanes'
placeholders.

## Cross-lane needs (success path of `closure_analyze`)
- typeck-euv: hir/place.rs (above), `ExprUseVisitor.new` / `consume_body` / `consume_expr`, `TypeInformationCtxt_FnCtxt`,
  `Delegate_provided.copy` / `.bind`.
- typeck-impl: `FnCtxt::node_ty`, `normalize`, `require_type_is_sized`, `remove_deferred_call_resolutions`,
  `structurally_resolve_type`.
- typeck-coerce: `demand_eqtype`, `demand_suptype`. typeck-callee-cast: `DeferredCallResolution::resolve`.
- **Not assigned to any lane**: the `upvars_mentioned` provider (compiler/rustc_passes/src/upvars.rs, ~100 lines; the
  query has no provider in rust-ts). `analyze_closure` calls it for every closure before edition 2021, the 2229 migration
  analysis and euv's `cat_upvar` / `walk_captures` need it in every edition. Recommend a small-gaps item.
- Error path only (wave 19 not needed): `MigrationLint` uses `Diag` / `span_suggestion` / `multipart_suggestion` and
  `emit_node_span_lint`, all already ported; it is reached only before edition 2021 when
  `rust_2021_incompatible_closure_captures` is not `allow` (it is allow-by-default).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: `markers ok (15215; vendor 3888)`; upvar.rs 52/52.
- `bun test src/rustc_hir_typeck --timeout=60000`: 23 pass / 0 fail (contract.test.ts 12, upvar.test.ts 11). upvar.test.ts
  covers `determine_capture_info`, `determine_place_ancestry_relation`, `truncate_place_to_len_and_update_capture_kind`
  (MutBorrow -> UniqueImmBorrow), `adjust_for_{move,use,non_move}_closure`, `restrict_capture_precision` (index / raw
  pointer / union), `restrict_repr_packed_field_ref_capture`, `truncate_capture_for_optimization`,
  `apply_capture_kind_on_capture_ty`, `should_reborrow_from_env_of_parent_coroutine_closure`, the `construct_*_string`s,
  `migration_suggestion_for_2229`, `migration_message`, and `InferBorrowKind` (non-upvar places ignored; upvar places stop
  at the pending `Place` clone), on fake places written after hir/place.rs.
- No pre-existing test re-pinned.

## Samples
Base = a temporary worktree at `a5910d3` (`RUST_TS_AGENT=typeck-upvar-base`, removed afterwards), lane = this branch
(`RUST_TS_AGENT=typeck-upvar`), same cases. Per-case status and stop are identical to base in all three suites (0 changed).

| suite | lane run | MATCH | DIFF | UNPORTED | CRASH | base run (same counts) |
|---|---|---|---|---|---|---|
| tydump-minicore (46, full) | `20261015-082000-typeck-upvar-reot` | 5 | 0 | 41 | 0 | `20261015-082346-typeck-upvar-base-9t7j` |
| tydump-nocore `--sample 100 --seed typeck-upvar` | `20261015-082023-typeck-upvar-w792` | 73 | 0 | 27 | 0 | `20261015-082401-typeck-upvar-base-7f8k` |
| hir-tree-nocore `--sample 100 --seed typeck-upvar` | `20261015-082101-typeck-upvar-g4rr` | 99 | 0 | 1 | 0 | `20261015-082435-typeck-upvar-base-ry4w` |

Top stops (none reaches upvar.rs): tydump-minicore 34x old-solver `FulfillmentContext::new`, 3x `check_unused_traits
provider`, 2x `StableHash without a TS impl`; tydump-nocore 12x `QueryKey for (CanonicalImpliedOutlivesBoundsGoal, bool)`,
4x `LateParamRegionKind::from_bound`, 3x `check_unused_traits provider`, 3x `RegionName::is_named`; hir-tree-nocore 1x
`StableHash without a TS impl` (also on base). A hand-written no_core closure (`phase-diff`) stops before typeck at
`rustc_interface::passes::analysis (M3+)`.

Note: an earlier base attempt was run by mistake in `.data/integ` while root was mid-merge (`372b3d8`, conflicted
`pat.ts`); it only read the tree (runs `20261015-082157/082217/082257-typeck-upvar-base-*`) — ignore those runs.
