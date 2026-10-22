# Handoff: fix-w23-bck (merge-w23 fixer, borrowck side)

Branch `lane/fix-w23-bck` (base `f0e9a0cf` on integ-w19, no merges).

## Cause (shared by every failure)
bck-core filled `BorrowSet::build`, so `mir_borrowck` now runs further: `BorrowSet::build`, then bck-tc-a's `type_check`
(`free_region_relations::create` (bck-tc-b), `check_user_type_annotations`, `visit_body`). The first `Assign` of a body
calls `sub_types` -> `relate_types` (bck-tc-b), which builds `UniverseInfo::relate(a, b)` eagerly (relate_tys.rs:40, as
upstream). That is a **bck-diag-f stub**:
`rustc_borrowck::diagnostics::bound_region_errors::UniverseInfo::relate`.
Bodies with user type annotations stop earlier, at `check_user_type_annotations` -> `ascribe_user_type` ->
`ConstraintConversion::convert_all` -> `OutlivesConstraintSet::push` (bck-regions-b stub).

I checked the path with a JS stack for the contract case and for one `push` case. Every stop is a real `unported(...)`
stub of a lane that is not filled yet. I found no JS TypeError, no undefined access and no ICE on the way, so no
borrowck code needed a fix. Each test is re-pinned to the exact new stop. No assertion was loosened and no case was
deleted.

## Tests (each now pins the exact stop it reaches)
| test | old pin | new pin |
|---|---|---|
| `src/rustc_borrowck/contract.test.ts` "mir_borrowck: trivial const and tainted body return early; a real body reaches the first stub" | `rustc_borrowck::borrow_set::BorrowSet::build` (bck-core) | `rustc_borrowck::diagnostics::bound_region_errors::UniverseInfo::relate` (bck-diag-f). The comment lists the path. |
| `src/rustc_hir_analysis/collect_test/misc.expected.txt:80` (`rpit`'s opaque `type_of`, through `mir_borrowck` of `rpit`) | same | same |
| `src/rustc_lint/late_c.oracle.test.ts` blocked `impl_trait_overcaptures` (RPIT with a body) `blocked_by` | same | same |
| `src/rustc_lint/late_e2.oracle.test.ts` TAIT `opaque_hidden_inferred_bound` `stop` | same | same |
| `src/rustc_hir_analysis/check/compare_impl_item.oracle.test.ts` `PENDING`: 11 end-to-end cases (e0049_fn, e0049_fn_fewer, e0049_impl_trait, e0050, e0053_kinds_fn, e0053_sig, e0185, e0186, e0195, e0643, refine_rpitit). Still exit 70 with exactly one `rust-ts: unported:` line. | same | same. The doc comment is updated. |

The contract test's count tests are unchanged (this lane filled no stub).

## PlaceholderIndices reconciliation
- **Before**: both lanes already stored a `KeyedSet<PlaceholderRegion>(intern_key)`. bck-tc-a built it inline in
  `type_check` (`new PlaceholderIndices(new KeyedSet(..))`). bck-regions-a added `default_PlaceholderIndices()` (values.ts).
  Its `insert` / `lookup_index` / `lookup_placeholder` work by value (`intern_key_eq`) in insertion order, which is the
  `FxIndexSet` index (`insert_full` / `get_index_of` / `get_index`).
- **Now**: there is one constructor. `type_check/mod.ts` calls `default_PlaceholderIndices()` from `region_infer/values.ts`,
  the `#[derive(Default)]`. The direct `PlaceholderIndices` import from values.gen.ts is gone and the `// PORT:` comment
  is updated. values.ts is unchanged. Its by-value, insertion-index methods are the single definition of the semantics.
- **`clone_PlaceholderIndices` (generated, values.gen.ts:102)** rebuilds a plain `Set` (`new Set([...v.indices])`), so the
  `KeyedSet` class is lost. It is reached through `clone_MirTypeckRegionConstraints` in
  `nll::compute_closure_requirements_modulo_opaques` (upstream `constraints.clone()`). **This does not matter today.**
  The clone holds the same, already-deduplicated elements in the same order, and values.ts's methods never rely on
  `Set.has` / `Set.add` dedup: `insert` scans by value before `add`. Only code that calls `indices.has(..)` directly on a
  clone would go wrong, and no such code exists. A codegen fix belongs to `tools/codegen`, not this lane: clone a
  struct-keyed `FxIndexSet` as `KeyedSet(intern_key)`, or keep the source set's class.

## Files touched
`src/rustc_borrowck/contract.test.ts`, `src/rustc_borrowck/type_check/mod.ts` (constructor only),
`src/rustc_hir_analysis/collect_test/misc.expected.txt`, `src/rustc_hir_analysis/check/compare_impl_item.oracle.test.ts`,
`src/rustc_lint/late_c.oracle.test.ts`, `src/rustc_lint/late_e2.oracle.test.ts`.

## Coverage
No function was ported or unported. type_check/mod.rs 40/40, region_infer/values.rs 35/35.
`bun scripts/coverage.ts --check`: markers ok (21236; vendor 4330).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_borrowck src/rustc_lint src/rustc_hir_analysis --timeout=120000`:
  **405 pass, 0 fail** (35 files).
- Full unit suite not run (root runs it).

## Samples (`RUST_TS_AGENT=root-f5de`, compared case by case with the w24 base runs)
| suite | lane run | M / D / U / C / T / UNSTABLE | vs base |
|---|---|---|---|
| tydump-minicore (46) | `fixbck-tydump-minicore` | 45 / 0 / 1 / 0 / 0 / 0 | identical to `20261022-210451-root-f5de-wos5` |
| mirdump-minicore (46) | `fixbck-mirdump-minicore` | 45 / 0 / 1 / 0 / 0 / 0 | identical to `20261022-210534-root-f5de-p8q4` |
| tydump-ui `--sample 300` | `fixbck-tydump-ui` | 261 / 0 / 37 / 0 / 0 / 2 | same statuses as `20261022-210624-root-f5de-zjq3`; only stop messages changed |
| mirdump-ui `--sample 300` | `fixbck-mirdump-ui` | 271 / 0 / 29 / 0 / 0 / 0 | `20261022-211125-root-f5de-mzgb` + 2 UNPORTED -> MATCH (from the merged base) |
| borrowck-ui `--sample 300` | `fixbck-borrowck-ui` | 0 / 0 / 300 / 0 / 0 / 0 | same statuses as `20261022-211729-root-f5de-86qn` |

**No MATCH lost, and no new DIFF / CRASH / TIMEOUT.** Run dirs are under `$RUST_TS_DATA/runs/`.

### Where borrowck-ui stops now (300 sampled cases)
| n | stop | lane | reached from |
|---|---|---|---|
| 209 | `rustc_borrowck::diagnostics::bound_region_errors::UniverseInfo::relate` | bck-diag-f | `type_check` -> `visit_body` -> `sub_types`/`relate_types` |
| 74 | `rustc_borrowck::constraints::OutlivesConstraintSet::push` | bck-regions-b | `check_user_type_annotations` -> `ascribe_user_type` -> `ConstraintConversion::convert_all` (also other constraint conversions) |
| 12 | `polonius_engine::AllFacts::default (vendor polonius-engine, plan-m4 D7, wave 26)` | bck-polonius-legacy | `-Zpolonius` (legacy) revisions |
| 5 | `rustc_metadata::rmeta::decoder::cstore_impl: Decodable for mir::Body<'static>` | metadata | aux crates |

In the base, 287 cases stopped at `replace_regions_in_mir` and 13 at `eval_in_interpreter`; the CTFE lanes cleared the
latter. In tydump-ui / mirdump-ui, the `mir_borrowck` stops are 22 `UniverseInfo::relate` each and 5 `push` (tydump-ui).

## `unported(...)` left / `// PORT:` decisions
- No new `unported(...)`.
- One `// PORT:` changed: type_check/mod.ts `type_check` (the derived `Default`s now name `default_PlaceholderIndices`).

## For root / other lanes
- **bck-diag-f**: `UniverseInfo::relate` (and `UniverseInfo::other`, which `eq_args` etc. call) is now the first stop of
  almost every real body. It is the most valuable stub to fill next.
- **bck-regions-b**: `OutlivesConstraintSet::push` comes next, on every body with user type annotations.
- Root re-pins at merge: if bck-diag-f / bck-regions-b land in the same merge, the same 5 tests move together again
  (contract runtime stop, misc.expected.txt:80, late_c `blocked_by`, late_e2 `stop`, compare_impl_item `PENDING`).
- tools/codegen: optional `clone_PlaceholderIndices` fix (see above).
