# Handoff: coherence (wave 17, M3): rustc_hir_analysis `coherence/*`

Branch `lane/coherence` (from main `3e4773f`, no merges).

## Result
- All of `compiler/rustc_hir_analysis/src/coherence/*` is ported, every fn in upstream order with markers, including
  `builtin/coerce_shared.rs` (the `mod coerce_shared;` of builtin.rs), and diagnostics.rs:2078
  `UncoveredTyParam::into_diag` (assigned to this lane by the hirtylowerer-contract table).
- `coherence::provide` (coherence/mod.rs:142) is wired into lib.ts's `provide` at upstream's position (after
  `collect::provide`). The 8 queries `coherent_trait`, `crate_inherent_impls`, `crate_incoherent_impls`, `inherent_impls`,
  `crate_inherent_impls_validity_check`, `crate_inherent_impls_overlap_check`, `coerce_unsized_info`,
  `orphan_check_impl` now have real providers.
- Reachable today and oracle-exact on test crates: E0199, E0200, E0390 (+ reference note), E0118, E0592 (within one
  impl), E0658 (`Freeze`), E0322, E0328, the specialization-trait and restricted-trait errors, E0120, and the inherent /
  incoherent impl maps (order checked against the oracle's metadata).
- Everything that needs rustc_trait_selection (overlap, `ObligationCtxt`, `traits::misc`, error reporting) or other
  lanes' stubs stops UNPORTED at a named stand-in (below).

## Files
- New: `src/rustc_hir_analysis/coherence/{mod,builtin,inherent_impls,inherent_impls_overlap,orphan,unsafety}.ts`,
  `coherence/builtin/coerce_shared.ts`.
- New tests: `src/rustc_hir_analysis/coherence.test.ts`, `src/rustc_hir_analysis/coherence_test/` (`run.ts` + 16 crates).
- Edited call sites:
  - `src/rustc_hir_analysis/lib.ts`: `import * as coherence from "./coherence/mod.ts"` at the `mod coherence;` line, and
    `coherence.provide(providers)` (was a commented line).
  - `src/rustc_hir_analysis/diagnostics.ts`: `UncoveredTyParam_into_diag` + `UncoveredTyParam_diagnostic` (the manual
    `impl Diagnostic`).
  - `src/rustc_hir_analysis/contract.test.ts`: the provider count 45 -> 53 and a check that the 8 coherence providers are
    installed (same kind of re-pin as variance-outlives did).

## Coverage
`bun scripts/coverage.ts --missing <file>`: 0 missing for every file.

| upstream file | ported/total |
|---|---|
| coherence/mod.rs | 6/6 |
| coherence/builtin.rs | 20/20 |
| coherence/builtin/coerce_shared.rs | 25/25 |
| coherence/inherent_impls.rs | 7/7 |
| coherence/inherent_impls_overlap.rs | 7/7 |
| coherence/orphan.rs | 5/5 |
| coherence/unsafety.rs | 1/1 |
| diagnostics.rs (hand fns) | 2/2 |

`bun scripts/coverage.ts --check`: markers ok (14437; vendor 3888). rustc_hir_analysis 569/799.

## Tests (`coherence.test.ts`, 17 tests, all green)
The runner `coherence_test/run.ts` stops the ported driver after expansion and then:
- `check`: lib.rs `check_crate`'s coherence block without `check_type_wf`;
- `pieces`: the same, but each trait runs `coherent_trait`'s per-impl checks without its two calls into other lanes'
  stubs (`specialization_graph_of`, `check_negative_auto_trait_impl`); traits in order of their first impl, as rustc's
  wfcheck reaches them. Valid on crates with no overlapping impls and no negative auto impls (documented in run.ts);
- `inherent` / `extern`: `inherent_impls` per local ADT / trait / foreign type as DefIndex lists, computed by the port
  vs decoded from the oracle-built `.rmeta` of the same crate;
- `incoherent` / `extern-incoherent`: the same for `crate_incoherent_impls` (a `#![rustc_coherence_is_core]` crate).

1. Oracle-exact stderr (exit code + stderr): unsafety.rs (E0199 x2, E0200 x2, incl. `print_trait_sugared` with
   generics), inherent_err.rs (E0390 x3, E0118, E0592), manual.rs (E0658 Freeze, E0322, E0328, specialization trait,
   restricted trait), drop.rs (E0120 x2), orphan_local_auto_ok.rs (clean).
2. Oracle error codes pinned, port stderr = oracle or PENDING (stops at one of the exact texts below):

   | crate | oracle | PENDING at |
   |---|---|---|
   | unsafety.rs (`check` mode) | E0199 E0200 E0199 E0200 | `specialization_graph_of provider (not ported)` |
   | orphan_e0210.rs (+ aux) | E0210 x2 | `rustc_metadata::rmeta::decoder::cstore_impl: Decodable for ty::TraitDef` |
   | orphan_e0117.rs (+ aux) | E0117 x2 | same |
   | orphan_auto.rs (+ aux) | E0321 E0117 | same |
   | orphan_local_auto.rs | E0321 | `rustc_trait_selection::traits::normalize_param_env_or_error` (`param_env` of `is_sized`) |
   | copy.rs | E0204 E0206 | `rustc_trait_selection::traits::normalize_param_env_or_error` |
   | coerce_unsized.rs | E0375 E0377 | same |
   | object_overlap.rs | E0371 | `rustc_trait_selection::traits::util::expand_trait_aliases` (`dyn` lowering) |
   | inherent_dyn.rs | E0785 | same |
3. Collection order vs the oracle's metadata: inherent.rs (impls in modules, fn bodies, `const _` blocks, through type
   aliases, on an extern type; 5 impls of `A` in definition order), inherent_core.rs (`inherent_impls` and the
   incoherent map over 13 primitive self types, two of them with 2 impls).

Sample difftests (lane HEAD, `RUST_TS_AGENT=coherence`):
- `tydump-nocore --sample 150`: 27 MATCH / 0 DIFF / 123 UNPORTED (121 `check_type_wf`, 1 `codegen_fn_attrs`, 1
  `check_proc_macro`) — identical to main `3e4773f` on the same sample (27 / 0 / 123).
- `hir-tree-nocore --sample 100`: 99 MATCH / 0 DIFF / 1 UNPORTED.

## `unported(...)` left (all stand-ins, local to the file that calls them)
- mod.ts `check_negative_auto_trait_impl` -> `rustc_hir_analysis::check::always_applicable::check_negative_auto_trait_impl`
  (lane check-region-intrinsic). Repoint to `check/always_applicable.ts` when it merges.
- inherent_impls_overlap.ts -> `rustc_trait_selection::traits::coherence::overlapping_inherent_impls`,
  `...::add_placeholder_note`; stub types `SkipLeakCheck`, `IntercrateAmbiguityCause` (only `add_intercrate_ambiguity_hint`),
  `OverlapResult` (only the two fields read).
- orphan.ts -> `rustc_trait_selection::traits::ObligationCtxt::new` (only reached for alias types in the trait ref).
- builtin.ts (also used by coerce_shared.ts):
  - `rustc_trait_selection::traits::ObligationCtxt::new` / `::new_with_diagnostics` (`ObligationCtxtView`: the methods
    called: `register_obligation`, `evaluate_obligations_error_on_ambiguity`, `resolve_regions_and_report_errors`,
    `resolve_regions`, `deeply_normalize`, `sup`);
  - `rustc_trait_selection::traits::misc::type_allowed_to_implement_copy` / `type_allowed_to_implement_const_param_ty`
    with local copies of `CopyImplementationError`, `ConstParamTyImplementationError`, `InfringingFieldsReason`;
  - `err_ctxt(infcx)` calls the real `infcx.err_ctxt()` (its placeholder stops today) and views the pending
    `TypeErrCtxt` as `TypeErrCtxtView` (`report_fulfillment_errors`, `report_mismatched_types`);
  - `rustc_middle::ty::pattern::Pattern: Display` (`Pattern` is pending in ty/decls.ts);
  - `rustc_abi::LayoutData::is_zst` / `is_1zst` (layout is M4; `tcx.layout_of` stops at its placeholder first anyway).

## PORT decisions (please record)
1. `Result::and` is a local `and(self, res)` with the argument evaluated first (as impl_wf_check.ts); every `.and(..)`
   chain evaluates all its operands in order, as upstream.
2. rustc_next_trait_solver's coherence items (`OrphanCheckErr`, `orphan_check_trait_ref`, ...) are imported from
   `rustc_next_trait_solver/coherence.ts` directly: rustc_trait_selection traits/coherence.rs is
   `pub use rustc_next_trait_solver::coherence::*`.
3. `FxIndexSet<DefId>` (uncovered params) is a `DefIdSet`; `FxIndexMap<Ident, Span>` a `KeyedMap` on `Ident`'s Hash/Eq
   (name + syntax context); `IndexVec<RegionId, Option<ConnectedRegion>>` an array with holes (`insert` / `remove` as
   `IndexVec<I, Option<T>>`'s).
4. `infringing_fields_error`'s `BTreeMap<(String, String), Vec<Span>>` is a `Map` iterated after sorting by Rust's
   `(String, String)` order (UTF-8 bytes).
5. coherence/mod.ts exports its private fns (`check_impl`, `coherent_trait`, `check_object_overlap`,
   `enforce_trait_manually_implementable`, `enforce_empty_impls_for_marker_traits`) for coherence_test/run.ts.
6. `EarlyParamRegion::is_named` is a local copy of rustc_middle print/pretty.ts's private stand-in (region.rs:31,
   `self.name != kw::UnderscoreLifetime`), pending ty-results.

## For root
1. **Bug outside this lane (blocks `check_crate`'s coherence loop):** rustc_middle `hir/mod.ts`'s
   `providers.all_local_trait_impls` returns the resolver's map, which is keyed by `DefId_hash_key` strings with
   `[DefId, impls]` entries, while queries.gen.ts declares `Map<DefId, LocalDefId[]>`. `tydump_dump.ts`'s `check_crate`
   (and lane check-check's lib.rs `check_crate`) iterate `.keys()` and would pass strings to `coherent_trait` once
   `check_type_wf` stops being the first stop (`DefId_key: crate number undefined`). coherence_test/run.ts reads the
   entries instead (`all_local_trait_impls_keys`). Suggest the provider build a `DefIdMap` (or `Map<DefId, ..>` in
   insertion order).
2. Repoint the stand-ins listed above when check-region-intrinsic, trait-sel-traits-a/-b/-c and errctxt land.
3. queries.gen.ts value types still `unknown` that coherence casts: `crate_inherent_impls` (`[unknown, Result]`),
   `impl_trait_header`, `trait_def`, `associated_items`, `param_env`, `generics_of`, `type_of`.
4. rustc's coherence error order follows wfcheck (e.g. `adt_destructor` -> `coherent_trait(Drop)` while checking a
   struct), so `pieces` keeps Drop impls in their own crate. When check-wf lands, the tests can switch to the real
   `check_crate` order.
5. Extern-trait cases (E0117 / E0210 / cross-crate E0321) wait on `Decodable for ty::TraitDef` in
   rustc_metadata cstore_impl.ts; E0204/E0375/E0377/E0321(generic) wait on `normalize_param_env_or_error`.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: markers ok.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: see "Test run".

## Test run
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools` at `10cd69f`: **4977 pass, 1 skip (the pre-existing
  linux-only test), 0 fail** (4978 tests, 310 files, 997 s), including coherence.test.ts 17/17 and contract.test.ts 10/10.
