# Handoff: infer-core (M3, wave 16): rustc_infer infer/mod.rs (rest), at.rs, resolve.rs, freshen.rs

Branch `lane/infer-core` (from main `816b5c5`, no merges). Filled the stubs of the infcx-contract split row "infer-core".

## Files
- **Ported (assigned):**
  - `src/rustc_infer/infer/mod.ts`: `Drop` (`drop()`), `ValuePairs::ty`, `SubregionOrigin::{to_constraint_category, span,
    from_obligation_cause}`, `display_FixupError`, `InferOk` (2), the whole `impl InferCtxt` (mod.rs:729 and :1914),
    `ToFreshVars`, `InferenceLiteralEraser`, `TypeTrace` (4), `RegionVariableOrigin::span`, `unresolved_root_variables_of`.
    No `unported_methods` list is left in the file.
  - `src/rustc_infer/infer/at.ts`: `at`, `fork`, `fork_with_typing_mode`, `At` (7), the 14 `ToTrace_<T>` descriptors.
  - `src/rustc_infer/infer/resolve.ts`: `DeepResolverIgnoringRegions` (new + `TypeFolder`), `deeply_resolve_via_region_graph`,
    `FullTypeResolver` (`FallibleTypeFolder`).
  - `src/rustc_infer/infer/freshen.ts`: `TypeFreshener` (new, freshen_ty/const, `TypeFolder`, fold_infer_ty).
- **New tests:** `src/rustc_infer/infer_core.test.ts` (10 tests) with a rustc-dev oracle
  `src/rustc_infer/infer_core_oracle/{probe.rs,empty.rs,infer_core.stdout}` (as rustc_middle's sty_oracle; `REGEN=1`
  rebuilds the probe and rewrites the fixture).
- **Edited outside my files (needed for a green `bun test`; please review):**
  - `src/rustc_infer/contract.test.ts`: the placeholder count is now `> 0` (it was `> 250`; it falls as every wave-16 lane
    fills stubs: 200 after this lane), and the two `next_ty_var` lines of "the contract's placeholders stop as UNPORTED"
    are dropped (`next_ty_var` is ported). Every lane of the wave touches that count: expect a trivial merge conflict.
  - `src/rustc_hir_analysis/hir_ty_lowering/mod_a_test/lower.expected.txt`: 2 PENDING texts move forward
    (`fresh_args_for_item` is ported; both cases now stop at `rustc_trait_selection::infer::InferCtxt::can_eq`, wave 17).
    No matching case changed.

## Coverage (`bun scripts/coverage.ts --missing`)
infer/mod.rs 123/123, at.rs 25/25, resolve.rs 11/11, freshen.rs 8/8. `coverage.ts --check`: `markers ok (13481; vendor 3888)`.

## Tests / checks
- Oracle: the probe runs one script on rustc's own `InferCtxt` (type/int/float/const vars across two universes; raw
  equate/sub-unify/instantiate; shallow/deep/unification-table/numeric-default/region-graph resolution with `FixupError`
  Debug + Display; `ty_to_string`; freshening; `ty_or_const_infer_var_changed`; `is_ty_infer_var_definitely_unchanged`;
  `probe` rollback; `fork`; `fork_with_typing_mode`; `instantiate_binder_with_fresh_vars`; `typing_env`). 59 of its 62
  lines are byte-identical on the port. The 3 `fork` lines stop UNPORTED at the generated
  `clone_ProjectionCacheStorage` (`SnapshotMapStorage` clone, infcx-contract "unported left"); the test asserts that stop
  and drops those lines until it is real.
- PORT(test) in infer_core.test.ts: the raw `InferCtxtLike` ops (context.rs, infer-relate) and `InferCtxt::probe`
  (snapshot/mod.rs, infer-opaque-snapshot) are done with what they call upstream on the ported tables; `InferCtxtLike::cx`
  (context.rs placeholder) is served per instance as `self.tcx`; the fake tcx answers `type_length_limit` with the default
  1048576 (Display of `Ty`).
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4740 pass, 1 skip, 1 fail before the mod_a re-pin; the
  fail was the moved PENDING stop above. After the re-pin, mod_a + rustc_infer: 21/21 pass.
- `RUST_TS_AGENT=infer-core bun scripts/difftest.ts --suite hir-tree-nocore --sample 100`: 99 MATCH, 0 DIFF, 1 UNPORTED
  (pre-existing `skip_binder of tcx.fn_sig(..)`, delegation/ice-issue-122550.rs), run `20261014-163313-infer-core-hqv7`.

## `unported(...)` left (all in mod.ts)
- `SubregionOrigin::to_constraint_category`: `rustc_middle::mir::ConstraintCategory (mir, M4): Predicate |
  SolverRegionConstraint | BoringNoLocation` (same convention as rustc_middle `ObligationCause::to_constraint_category`).
- `deeply_resolve_via_region_graph`: the `bug!("`{value:?}` is not fully resolved")` and the `delayed_bug` of the same
  message: a D4 `TypeFoldable` descriptor has no `Debug` of `T`. Reached only when the region-graph result still has
  inference variables.
- `insert_placeholder_assumptions`: `rustc_data_structures::transitive_relation::TransitiveRelation::base_edges` (not
  ported; rustc_type_ir region_constraint.ts has stand-ins only). `-Zassumptions-on-binders` only.

Reached through other lanes' placeholders (they stop UNPORTED until those lanes merge): region-constraint collector
(`next_region_var`, `sub_regions`, `universe_of_region`, ...), opaque storage (`take_opaque_types`, `drop`, ...),
`TypeRelating` / `LatticeOp` (`At::sub/sup/eq/lub` on the old solver), `Obligation::new` (`goals_to_obligations`),
`enter_forall` (`subtype_predicate`), `in_snapshot`, `ProjectionCache::clear` (`fork_with_typing_mode`),
`LexicalRegionResolutions::resolve_region` (`FullTypeResolver` on `ReVar`).

## PORT decisions (please record)
1. **`PORT(decls): pending root` in at.ts:** `TypeRelating` and `LatticeOp` get a local augmentation declaring
   `relate<T>(a, b, d: Relate<T>): RelateResult<T>` (the provided `TypeRelation::relate`, which `At` calls). infer-relate
   must put `relate` on both prototypes (e.g. delegating to `TypeRelation_provided.relate`); root may move the declaration
   into decls.ts.
2. **Folder impls of generated interfaces** (`FullTypeResolver`, `InferenceLiteralEraser`): a folder object built over the
   struct (`FullTypeResolver_folder(self)`, `InferenceLiteralEraser_folder(self)`); the provided folder methods delegate to
   `TypeFolder_provided` / `FallibleTypeFolder_provided`. Generated classes (`DeepResolverIgnoringRegions`,
   `TypeFreshener`) get `interface X extends TypeFolder {}` augmentations and prototype methods; their `new` is
   `Object.assign(X, { new })` (rustc_hir precedent).
3. **`ToFreshVars`** (a struct local to `instantiate_binder_with_fresh_vars`) is a class inside the method body.
4. **`TypeFreshener` maps** are `KeyedMap`s on `intern_key` (keys `InferTy` / `InferConst` are data enums).
5. **`dcx()`**: `&self.tainted_by_errors` is a `MutRef` getter/setter view of `tainted_by_errors_`.
6. **`is_ty_infer_var_definitely_unchanged`**: `inner.try_borrow()` is always `Ok` (no borrow flags in the port).
7. **Clones in `fork`**: selection/evaluation caches share keys and values (interned / never mutated); `Assumptions`
   share their frozen `TransitiveRelation`s (`clone_Assumptions` in mod.ts, `clone_placeholder_assumptions` in at.ts).
8. **`TypeFreshener::fold_ty`**: the `#[cfg(debug_assertions)]` `Placeholder | Bound => bug!` arm is dropped (rustc ships
   without debug assertions).
9. **`get_region_var_infos`**: `assert!(data.is_empty(), "{:#?}", data)` panics with `debug_RegionConstraintData` in
   PRETTY mode.

## For root
- contract.test.ts and mod_a's expected file: see "Edited outside my files".
- Codegen: `clone_ProjectionCacheStorage` (SnapshotMapStorage) blocks `fork`; `debug_Binder` / `debug_TypingMode` stop at
  `unported_debug` for `BoundVarKinds` / `LocalDefIds` (seen while writing the oracle; worked around in the test).
