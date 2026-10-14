# Handoff: privacy-effvis (M3): rustc_privacy

## Files
New:
- `src/rustc_privacy/lib.ts`: port of `compiler/rustc_privacy/src/lib.rs`. Covers `DefIdVisitor` and its skeleton,
  `FindMin`/`VisibilityLike`, `DefIdsToImplsCollector`, `EmbargoVisitor`, `ReachEverythingInTheInterfaceVisitor`,
  `TestReachabilityVisitor`, `NamePrivacyVisitor`, `TypePrivacyVisitor`, `SearchInterfaceForPrivateItemsVisitor`,
  `PrivateItemsInPublicInterfacesChecker`, `provide`, `check_mod_privacy`, `effective_visibilities` and
  `check_private_in_public`.
- `src/rustc_privacy/diagnostics.gen.ts` (generated) and `diagnostics.ts` (re-exports it).
- `src/rustc_privacy/privacy.test.ts` and `privacy_test/` (`run.ts`, 10 `.rs` cases with oracle `.stderr`/`.exit`).

Edited:
- `tools/codegen/types.sets.json`: new set `rustc_privacy` with `typemap_extra` set to tyir and ast_lowering (for
  `DiagArgFromDisplay`). It has 9 types and 9 Diagnostic/Subdiagnostic derives, and the report is clean.
- `src/rustc_interface/passes.ts` (the call site only): `rustc_privacy.provide(providers.queries)` now runs in
  upstream order, between `rustc_incremental::provide` and `rustc_query_impl::provide`. The pending-crates comment is
  updated to match.

`rustc_middle/middle/privacy.rs` was already 21/21, so it is unchanged.

## Coverage
- `--missing compiler/rustc_privacy/src/lib.rs`: 87/87.
- `diagnostics.rs`: generated.
- `bun scripts/coverage.ts --check`: markers ok (13422; vendor 3888).

`bunx tsc --noEmit -p .` is clean. `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4744 pass, 1 skip,
0 fail.

## Tests (oracle = pinned rustc, `--crate-type lib -A dead_code`, x86_64-unknown-linux-gnu)
13/13 tests pass:
- Effective visibilities (`#[rustc_effective_visibility]` dumps) are byte-identical on copies of
  tests/ui/privacy/effective_visibilities{,_full_priv,_glob}.rs and effective-visibilities-macro{,-2}.rs, plus a
  custom `ev_reach.rs` (fields, ctors, impls, assoc items, reexports).
- `check_private_in_public` is byte-identical on E0446 (impl assoc type, trait assoc type default),
  `ev_glob` (full mode) and a clean crate.
- `check_mod_privacy`:
  - On a crate without bodies it is clean, matching the oracle.
  - With bodies it stops UNPORTED (exit 70) at `typeck_root provider (not ported)`.
- Not reached: effective_visibilities_invariants.rs, which needs the stability pass ("module has missing stability
  attribute").

## Where the analysis path stops (none of these is in this lane's files)
- **Lints** (`private_interfaces`, `private_bounds`, `unnameable_types`, `exported_private_dependencies`):
  `emit_node_span_lint` reaches `rustc_lint::levels::shallow_lint_levels_on` (HIR lint levels, lane lint-levels-hir).
  This affects most of the upstream private-in-public tests. After that lane lands, `ev_*` can run in full mode.
- **Typeck-bound fns** (markers kept; they stop at `typeck_body` → `typeck_root provider (not ported)`):
  - `NamePrivacyVisitor`: visit_nested_body, visit_expr, visit_pat, check_expanded_fields, check_field,
    emit_unreachable_field_error, typeck_results.
  - `TypePrivacyVisitor`: visit_nested_body, visit_expr, visit_pat, visit_local, visit_ty, visit_infer,
    check_expr_pat_type.
- **`DefIdVisitorSkeleton::visit_const`**: calls `tcx.expand_abstract_consts`, which is still an `unported_methods`
  stub in `rustc_middle/ty/abstract_const.ts` (lane ty-results). Any const inside a visited type reaches it, for
  example an array length.
- **`ModuleItems::par_items` / `par_foreign_items`**: they call the unported `try_par_for_each_in` shim in
  `rustc_middle/hir/mod.ts` (sync/parallel.rs is not ported). The real driver therefore stops there in
  `check_private_in_public`. The test runner patches in a serial stand-in (`PORT (test)`). Root should port
  `rustc_data_structures/sync/parallel.rs` (its serial path) or replace the shim.
- Other UNPORTED stops seen in upstream tests come from other crates: `lookup_deprecation_entry`,
  `expand_trait_aliases`, metadata decode of `ObjectLifetimeDefault` / `TraitDef`, and `wfcheck::check_static_item`.

## unported(...) left
None in rustc_privacy. Every stop above comes from a dependency.

## PORT decisions
- `DefIdVisitor` is an interface plus `DefIdVisitor_provided`:
  - `type Result` becomes the property `DefIdResult` and `const SHALLOW` becomes `SHALLOW`, because
    `TypePrivacyVisitor` is also a HIR `Visitor` whose `Result` is `()`.
  - Implementors name their field `tcx_` because the trait method is `tcx()`.
  - `SearchInterfaceForPrivateItemsVisitor`'s field is `skip_assoc_tys_`.
- `DefIdVisitorSkeleton`'s inherent `visit_clauses` (lib.rs:161) is `visit_clauses_`, because
  `TypeVisitor::visit_clauses` needs the name.
- `TypePrivacyVisitor`'s `SpannedTypeVisitor` impl is the adapter `as_spanned_type_visitor()`, with the marker on
  `SpannedTypeVisitor_visit`.
- `&dyn fmt::Display` descriptions are thunks, so `LazyDefPathStr` stays lazy.
- `VisibilityLike` is one impl table per type plus `VisibilityLike_provided.of_impl(impl, SHALLOW, ..)`. `FindMin`
  carries `VL` and `SHALLOW` as fields. `MAX` is a fresh value per read.
- `EffectiveVisibility` is mutable in TS, so `.copied()` and the `resolutions().effective_visibilities.clone()`
  copy the values.
- `IndexSet` (the queue) is a local array plus set (`insert`/`extend`/`pop`/`clear`). `DefIdsToImpls` values are
  `FxHashSet` (hashbrown order) because `queue.extend(impls)` iterates them.
- `BoundConstness::visit_with` in `visit_clause` (HostEffect) is `V::Result::output()`, since it contains no types.
- `TyCtxt::typeck_body` takes the pending `BodyId` stand-in from rustc_middle decls, so the HIR `BodyId` is cast.
- Test runner (`privacy_test/run.ts`):
  - sets `trimmed_def_paths = true`, as `TimePassesCallbacks::config` does;
  - uses `hir_for_each_module` in place of the unported `par_hir_for_each_module`;
  - uses a serial `par_items` stand-in;
  - maps `Unported` to exit 70.
