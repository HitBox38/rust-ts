# Handoff: check-wf-b (M3, wave 17): rustc_hir_analysis `check/wfcheck.rs` lines 1140–end

Branch `lane/check-wf-b` (from main `3e4773f`, no merges).

## Result
- All 34 upstream fns of wfcheck.rs 1140..2806 are ported, in upstream order, with markers:
  `check_item_fn`, `check_eiis_fn`, `check_eiis_static`, `check_static_item`, `check_const_item`, `check_impl`,
  `check_where_clauses` (+ the nested `CountParams` visitor), `check_fn_or_method`, `check_method_receiver`,
  `confirm_type_is_not_a_method_generic_param`, `receiver_is_valid`, `legacy_receiver_is_implemented`,
  `check_variances_for_type_defn`, `HasErrorDeep`, `report_bivariance`, `IsProbablyCyclical`, `CollectUsageSpans`,
  the `impl WfCheckingCtxt` block at :2302 (`check_false_global_bounds`, `check_test_binder_body` + nested `validate`,
  `check_test_binder_forall`, `build_test_binder_assumptions`, `check_test_binder_region_constraints` + nested `err`,
  `check_test_binder_exists`), `check_type_wf`, `lint_redundant_lifetimes`.
- Types of the region, hand-written with `// rustc-type:` markers (wfcheck.rs is in no codegen set): the enums
  `ArbitrarySelfTypesLevel`, `ReceiverValidityError` (string unions), the structs `RedundantLifetimeArgsLint`,
  `TestBinderBody`, `TestBinderForall`, `TestBinderExists`, `WithWhereClauses<T>` (interfaces). Their derives are
  stand-ins (see "unported").
- **E0392 matches the oracle byte for byte**: `check_variances_for_type_defn` on 2 crates (9 errors each: type /
  lifetime / enum params, inline and `where` bounds, "only used recursively" via `*const Self` and `*const F<T>`, with
  and without a `phantom_data` lang item).
- Static WF (E0277 `Sync`) and receiver errors (E0307) are not reachable yet: they run inside
  `enter_wf_checking_ctxt` (check-wf-a) over `ObligationCtxt` (trait-sel-traits-a). The test checks the oracle's error
  and our exact stop text (PENDING).

## Files
- `src/rustc_hir_analysis/check/wfcheck.ts` (new; shared with check-wf-a, see "Merging with check-wf-a").
- `src/rustc_hir_analysis/check/wfcheck_b.test.ts` (new) and `src/rustc_hir_analysis/check/wfcheck_b_test/`
  (`run.ts`, `unused_params.rs`, `unused_params_phantom.rs`, `static_wf.rs`, `receiver.rs`).
- Nothing else. The file is not wired into the driver (`check_type_wf` / `check_well_formed` providers are
  `check::provide`, lane check-check), so no suite output can change.

## Merging with check-wf-a (both lanes add the same file)
Both branches add `check/wfcheck.ts`, so git reports an add/add conflict. Resolve it like this:
1. Take check-wf-a's file. Delete its block from `// ---- check-wf-b region: wfcheck.rs:1140–end` to the end of the
   file. That block holds its stand-ins for this region.
2. Append this lane's file from `// ==== lane check-wf-b: wfcheck.rs:1140..end ====` to the end.
3. Add this lane's `// ---- check-wf-b imports ----` block after check-wf-a's imports. Drop every specifier that
   check-wf-a already binds. The overlapping bindings are identical (same module, same name). Where check-wf-a imports
   a name type-only and this region needs the value, this region uses its own alias: `LocalDefIdC` (as check-wf-a),
   `TermC`, `GenericParamDefC`, `TraitErrorsC`, `SpanC`, `RegionC` (as check-wf-a), `ParamEnvC`, `GenericClausesC`.

This lane's block `// ==== lane check-wf-a: wfcheck.rs:1..1139 ====` holds stand-ins under check-wf-a's names and
signatures (taken from lane/check-wf-a `5b60494`): `and`, `WfCheckingCtxt` with its `Deref` forwarders, `enter_wf_checking_ctxt`, `as_obligation_upcast`, `ObligationCtxt`, `FulfillmentError`,
`TypeErrCtxt_report_fulfillment_errors`, `wf_clause_obligations`. It is discarded in step 1–2.

**Verified:** I built the merged file with these three steps against lane/check-wf-a `5b60494`. On it:
- `bunx tsc --noEmit -p .` is clean;
- `wfcheck_b.test.ts` passes. With the merge, the receiver case stops at `constness provider (not ported)`, through
  `tcx.param_env` in check-wf-a's `enter_wf_checking_ctxt`; that stop is in `PENDING_WF`.

The region-B `export interface ObligationCtxt { eq(..) }` is a deliberate interface merge with check-wf-a's
`ObligationCtxt` view: `eq` is the one member only this region uses.

## Tests (`wfcheck_b.test.ts`, 4 tests)
1–2. `unused_params.rs`, `unused_params_phantom.rs`: `run.ts variances` calls `check_variances_for_type_defn` on every
   ADT among the free items, as check.rs:828/:923 do. Our exit code and stderr equal the oracle's.
   - Negative control: dropping `&& !has_explicit_bounds` from `const_param_help` fails both tests.
3–4. `static_wf.rs` (oracle: E0277 `S: Sync`) and `receiver.rs` (oracle: E0307 `self: u32`): `run.ts wf` calls
   `check_static_item` / `check_item_fn` / `check_impl` on the free items. Ours must stop at one of `PENDING_WF`:
   - `rustc_hir_analysis::check::wfcheck::check_static_item (wave 17)` (collect/type_of.ts's stand-in, see "For root");
   - `rustc_hir_analysis::check::wfcheck::enter_wf_checking_ctxt (lane check-wf-a)` (this lane's stand-in);
   - after the merge, `constness provider (not ported)` or
     `rustc_trait_selection::traits::ObligationCtxt::new_with_diagnostics`.

   If ours does not stop, the test requires an exact oracle match.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: `markers ok (14399; vendor 3888)`.
- `bun scripts/coverage.ts --missing compiler/rustc_hir_analysis/src/check/wfcheck.rs`: 34/57 ported; every missing fn
  is in 1..1139 (check-wf-a). Nothing in 1140..end is missing.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: see "Test run" below.
- Sample difftests were not run: the file is not reachable from the driver (see "Files").

## `unported(...)` left (all stand-ins at the end of the file, each naming its owner)
- check-wf-a region (discarded at merge): `WfCheckingCtxt::{normalize, deeply_normalize, register_wf_obligation}`,
  `enter_wf_checking_ctxt`, `TypeErrCtxt::report_fulfillment_errors`, `traits::wf::clause_obligations`.
- rustc_trait_selection:
  - `traits::ObligationCtxt::new` (trait-sel-traits-a), used by `receiver_is_valid`;
  - `traits::wf::trait_obligations` (trait-sel-traits-b), used by `check_impl`.
- `rustc_hir_analysis::autoderef::Autoderef::new` (autoderef.rs is in no wave-17 lane). Every receiver that is not
  `Self` reaches it.
- `rustc_hir_analysis::check::compare_eii::{compare_eii_function_types, compare_eii_statics}`. These are EII; plan-m3
  scopes EII out.
- `rustc_hir_analysis::check::entry::check_for_entry_fn` (check/entry.rs, no lane). `check_type_wf` reaches it.
- `rustc_middle::ty::region::LateParamRegionKind::from_bound` (same stand-in as rustc_middle fold.ts).
  `lint_redundant_lifetimes` reaches it for every fn with late-bound lifetimes.
- `rustc_middle::ty::print::pretty: Display for Binder<TypeOutlivesClause>`: a test-binder error path.
- Codegen pending:
  - `RedundantLifetimeArgsLint: derive(Diagnostic)`, only when the allow-by-default lint fires;
  - `TestBinderBody` / `WithWhereClauses: derive(TypeFoldable/TypeVisitable)`, for `#[rustc_test_binder]` foralls and
    exists.

## PORT decisions (please record)
1. **`Deref for WfCheckingCtxt`.** It follows check-wf-a's representation: forwarding members on the class (`infcx`,
   `register_bound`, `register_obligation(s)`, `evaluate_obligations_error_on_ambiguity`). Code that upstream spells
   `wfcx.ocx.X` keeps `.ocx`. That is `check_false_global_bounds`' `self.ocx.infcx.tcx` /
   `self.ocx.register_obligation` and `check_test_binder_body`'s `self.ocx.evaluate_obligations_error_on_ambiguity()`.
2. **The `impl WfCheckingCtxt` block at :2302** is assigned to `WfCheckingCtxt.prototype` in this region. An
   `export interface WfCheckingCtxt` merges with the class.
3. **`check_where_clauses`' lazy `flat_map(..).map(..)`** (default obligations) and the WF `flat_map` are generators
   collected in upstream order: assoc-const obligations first (an eager `collect`), then WF, then defaults. The
   shadowed `gen_clauses` (`instantiate_identity`) is `gen_clauses_`.
4. **`check_impl` clones `obligation.cause` before setting its span.** Each Rust obligation owns its cause, so a cause
   object shared between TS obligations is never changed through another one.
5. **Derived `PartialEq`** of `LeafRegionConstraint` (`S = ()`) and of `Binder<(AliasTy, Region)>` is `intern_key`
   equality.
6. **`FxHashSet<DefId>` is `DefIdSet`** (`HasErrorDeep`, `IsProbablyCyclical`). `explicitly_bounded_params`
   (`LazyCell`) is a memoised closure.
7. **`check_type_wf`'s `a.and(b)` chain** runs every `par_*` in order; `res.and(..)` evaluates its argument first.
8. **Tracing:** `#[instrument]` / `debug!` stay as comments.

## For root
1. **Merge** as in "Merging with check-wf-a".
2. **Codegen.** Add `compiler/rustc_hir_analysis/src/check/wfcheck.rs` to set `rustc_hir_analysis`:
   - generated: `RedundantLifetimeArgsLint` (`derive(Diagnostic)`), `TestBinderBody` / `TestBinderForall` /
     `TestBinderExists` / `WithWhereClauses` (Clone, Debug, TypeFoldable, TypeVisitable), `ArbitrarySelfTypesLevel`,
     `ReceiverValidityError`;
   - `hand`: `WfCheckingCtxt`, `GATArgsCollector`, `HasErrorDeep`, `IsProbablyCyclical`, `CollectUsageSpans`.

   Then replace the stand-ins `RedundantLifetimeArgsLint_diagnostic`, `fold_TestBinderBody` and
   `fold_WithWhereClauses_TestBinderBody`, and the hand interfaces / unions.
3. **Repoints, all outside this lane's files:**
   - `decls.ts`: the `Pending<..>` aliases `TestBinderBody` / `TestBinderForall` / `TestBinderExists` become type
     re-exports from `./check/wfcheck.ts`.
   - `collect.ts:333/348/358`: build them instead of `unported`.
   - `collect/type_of.ts:596`: its `check_static_item` stand-in calls the real `check_static_item`. Read it lazily for
     init order.
   - check-check's stand-ins in check.ts: `wfcheck_check_static_item`, `wfcheck_check_const_item`,
     `wfcheck_check_where_clauses`, `check_variances_for_type_defn`.
   - `check::provide`: `check_type_wf` / `check_well_formed`.
4. **When trait-sel-traits-a/-b land**, repoint `ObligationCtxt_new`, `wf_trait_obligations` and check-wf-a's
   `wf_clause_obligations`.
5. **Unowned upstream items** that wfcheck needs and that no wave-17 lane has:
   - `autoderef.rs` (`Autoderef`), needed for E0307 beyond `self: Self`;
   - `check/entry.rs` (`check_for_entry_fn`), needed for `check_type_wf`;
   - rustc_middle `LateParamRegionKind::from_bound` (region.rs:92, 10 lines).

## Test run
(filled in below)
