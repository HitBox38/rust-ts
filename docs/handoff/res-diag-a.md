# Handoff: res-diag-a (wave 10, M2: rustc_resolve diagnostics/impls.rs lines 1–1977, diagnostics/mod.rs manual impls)

Branch `lane/res-diag-a` (from main 00f8a7b, no merges). Commits: the port; test updates for stubs this lane
filled; the oracle test; this handoff.

## Files
- `src/rustc_resolve/diagnostics/impls.ts` (my range only):
  - in place in the stub: `reduce_impl_span_to_impl_keyword` (:135) and the `TypoSuggestion` statics `new` /
    `typo_from_name` / `single_item` (:102–108);
  - a new block after the `TypoSuggestion` statics: `StructCtor::has_private_fields` (:78), then all 19 `impl
    Resolver` methods from `throw_unresolved_import_error` (:145) to `lookup_import_candidates` (:1898), in
    upstream order, then a few local helpers (marked, no upstream counterpart);
  - my imports are in the `// res-diag-a imports` block;
  - the `unported_methods(StructCtor ..)` call is deleted, and my 19 names are removed from
    `unported_methods(Resolver ..)`.
- `src/rustc_resolve/diagnostics/mod.ts`: `<FoundItemConfigureOut as Subdiagnostic>::add_to_diag` (mod.rs:1388)
  and `<Ambiguity as Diagnostic>::into_diag` (mod.rs:1535). That file has no `unported` left.
- New test files (mine):
  - `src/rustc_resolve/diagnostics/impls.test.ts`;
  - `src/rustc_resolve/diagnostics/impls_oracle/`, which holds `gen.ts` (the oracle generator), `run.ts` (the
    test driver) and `cases/*.rs` + `cases/*.stderr` (9 cases).
- **Outside my files** (root, please review; each is minimal):
  - `src/rustc_resolve/lib.ts`: `PrimTy_ALL` and `PrimTy_name` are now `export`ed. The `BuiltinTypes` scope of
    `add_scope_set_candidates` needs them. No other change.
  - In `impls.ts`, three shared stub import lines changed from type-only to value imports:
    `Session`, `Span` and `Symbol`.
  - Tests whose PENDING stop was one of this lane's stubs:
    - `build_reduced_graph.test.ts`:
      - `p_duplicate` and `p_macro_escape` are off PENDING and match the probe.
      - `p_duplicate` reports E0428 during expansion. The driver then aborts when the compiler is dropped. A new
        `EXPANSION_ERRORS` set names such cases. `run_case` asserts `has_errors()` accordingly, and keeps the
        compared sections in `last_dump`.
    - `ident.test.ts`: "resolve_path [crate] with finalize records the crate root res" is off PENDING and passes.
    - `macros.test.ts` (`register_builtin_macro`): the second registration now really reaches `dcx().bug(..)`, an
      ICE that unwinds out of `with_resolver`. The test now expects `with_resolver` to throw, and compares the
      registry it recorded before.

## Checks
- `bun scripts/coverage.ts --missing compiler/rustc_resolve/src/diagnostics/impls.rs`: 25/61 ported. **Nothing
  below line 1978 is missing**; the 36 that remain are res-diag-b's.
- `bun scripts/coverage.ts --missing compiler/rustc_resolve/src/diagnostics/mod.rs`: 2/2.
- `bun scripts/coverage.ts --check`: `markers ok (6690; vendor 2603)`.
- `bunx tsc --noEmit -p .` is clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 3390 pass, 1 skip (pre-existing), 0 fail.
- Sample difftests:
  - `RUST_TS_AGENT=res-diag-a bun scripts/difftest.ts --suite parse --sample 200`: 200/200 MATCH (run
    `20261013-132829-res-diag-a-u10t`).
  - `--suite resdump-nocore --sample 50`: 50 UNPORTED, every one at
    `rustc_lint::late::unerased_lint_store (pending lint-early-a)`, as before (run `20261013-132853-res-diag-a-bgox`).

## Tests
**How the oracle test runs.**
- `impls.test.ts` runs `impls_oracle/run.ts <case>.rs` in a subprocess, in `cases/`.
- `run.ts` takes `with_resolver` (macros_oracle/with_resolver.ts), runs expansion as build_reduced_graph.test.ts
  does, then `finalize_imports` and `report_errors(krate, [])`, then `FatalError.raise()` if
  `raise_fatal_after_resolve`.
- The test requires the whole stderr and the exit code to equal the fixture byte for byte, `aborting due to N
  previous errors` trailer included. The fixtures are the pinned rustc's output with the nocore arguments (edition
  2021, `--emit=metadata`).
- The cases are `#![crate_type = "lib"]` crates without fn bodies, so the oracle reports no later-phase errors
  (`requires sized lang_item`).

**Test-only stand-ins in run.ts** (installed only while the real code is a stub):
- an empty `CStore` (`had_extern_crate_load_failure` = false);
- the struct-visibility re-feed check by value, as res-graph does;
- `PathSource::is_expected` for `PathSource::Type` only (the upstream arm). Every `use` and `pub(in ..)` path
  goes through it, and late.rs is still the stub.

**Passing cases (5), byte-identical with the oracle:**
- `conflict_kinds`: E0428 for module, trait, type and alias/enum. The unit struct reports once per (name, span).
  `raise_fatal_after_resolve` fires.
- `conflict_values`: E0428 in the value namespace, for foreign fns and a unit-struct ctor.
- `conflict_imports`: E0255 and E0252 with the `as other_f` / `as OtherBig` rename suggestions (the byte-offset
  arithmetic of `add_suggestion_for_rename_of_use`).
- `conflict_same_import`: E0252. The removal suggestion is tool-only.
- `vis_errors`: E0742 AncestorOnly and Relative2018 with its `crate::outer` suggestion.

**PENDING (4).** The test asserts exit 70 and the exact `UNPORTED:` line:

| case | stops at (res-diag-b) |
|---|---|
| `unresolved_import` (E0432, grouped) | `Resolver::check_for_module_export_macro` |
| `vis_unresolved` (E0433) | `Resolver::report_path_resolution_error` |
| `private_import` (E0603) | `Resolver::report_privacy_error` |
| `ambiguous_glob` (E0659) | `Resolver::ambiguity_diagnostic` |

`unresolved_import` was validated locally. With no-op stand-ins for `check_for_module_export_macro`,
`on_unknown_data` and `find_cfg_stripped`, it matched the oracle byte for byte, including the grouped
`unresolved imports \`a::gone\`, \`a::lost\`` with two labels. The patch is kept outside the tree at
`$RUST_TS_DATA/tmp/res-diag-a/validate_patch.ts`.

**Other checks.**
- A guard test checks that each fixture shows the error code its case is named for.
- A freshness test reruns the oracle.
- Negative control: changing the `Other` prefix in `add_suggestion_for_rename_of_use` fails `conflict_imports`.
- Regenerate the fixtures with `bun src/rustc_resolve/diagnostics/impls_oracle/gen.ts`.

**Not covered yet.**
- "Consider importing" (`report_with_use_injections` / `show_candidates`) and most of `into_struct_error` need late
  resolution (lanes res-late, res-late-diag).
- `Ambiguity_into_diag` and `FoundItemConfigureOut_add_to_diag` get covered once `ambiguous_glob` and the
  `find_cfg_stripped` cases come off PENDING.

## `unported(...)` left
- In my code: `DefId_get_attrs_extern` for a *local* DefId (HIR, M3). It is never reached, because the only caller
  checks `!did.is_local()` first.
- Reached through other lanes' stubs:
  - **res-diag-b:** `on_unknown_data`, `find_cfg_stripped`, `import_candidates`, `show_candidates`,
    `UsePlacementFinder::check`, `BindingVisitor::visit_pat`, `ambiguity_diagnostic`, `report_privacy_error`,
    `find_span_of_binding_until_next_binding`, `extend_span_to_previous_binding`.
  - **wave 11 (CStore):** `cstore_mut().maybe_process_path_extern` in `lookup_import_candidates`. It is reached only
    in edition 2018+ with extern prelude entries.
  - **Queries for extern DefIds:** `tcx.is_doc_hidden`, `tcx.lookup_stability` and `tcx.attrs_for_def`. Their
    providers come with rustc_metadata.

## PORT decisions (please record)
1. **Placement.** The stub's layout is kept so that res-diag-b's stubs stay untouched. `has_private_fields` (:78)
   and the `impl Resolver` block are placed after the `TypoSuggestion` statics (:102–108); the markers keep the
   upstream lines. `reduce_impl_span_to_impl_keyword` stays where the stub had it.
2. **`macro_expanded_macro_export_errors`.** It is a `BTreeSet<(OrdSpan, OrdSpan)>`, and `report_errors` iterates it
   sorted by the `(OrdSpan, OrdSpan)` pair. The TS field is an insertion-ordered `KeyedSet`.
3. **`all_equal_value`.** `mod_diagnostics.iter_mut().flat_map(|d| d.message.take()).all_equal_value()` takes each
   message lazily, stopping at the first one that differs, as itertools does.
4. **Small mappings:**
   - `FormatArgs { this, .. }` uses a local `FormatArgs_default(this)` with the struct's default field values;
   - `BindingVisitor::default()` is `new BindingVisitor([], new Map())`;
   - `errors.retain(..)` is a filtered copy;
   - `ThinVec<PathSegment>::clone()` is `.map(ast.clone_PathSegment)`;
   - `Vec<Symbol>::sort()` sorts by the interned index (`Symbol: Ord`);
   - `str::cmp` in `early_lookup_typo_candidate` is a code-point compare (`str_cmp`);
   - `u32::checked_sub` is an explicit `hi >= lo` check;
   - `Option<DefId> ==` is the local `opt_DefId_eq`.
5. **`find_attr!(tcx, did, RustcDiagnosticItem(..))` for an extern `did`** reads `tcx.attrs_for_def(did)` through
   a local `DefId_get_attrs_extern`, the same stand-in as lib.ts's private `DefId_get_attrs`. Root: export lib.ts's
   and drop the copy.
6. **`tcx.lookup_stability(did)`** is cast to `rustc_attr_ir::Stability | undefined`, because queries.gen.ts types
   the value `unknown` and has no typemap entry.
7. **The `Session` downcast** in `lint_if_path_starts_with_module` uses `instanceof Session`, else
   `panic("expected a `Session`")`, as check_unused does. `StashKey::CallIntoMethod` is the string `"CallIntoMethod"`.

## Hash-map iteration
Everything this code iterates is a `Vec` or an `FxIndexMap`/`FxIndexSet`:
- `extern_prelude`, `macro_use_prelude`, `registered_attr_tools` and the resolution tables;
- the BTreeSet above, which is sorted explicitly.

The `FxHashMap`/`FxHashSet`s are only queried: `helper_attrs`, `name_already_seen`, `mods_with_parse_errors`,
`reported_spans`, `seen_modules`, `local_names`.

## For root (merging with res-diag-b)
- Both lanes edit `impls.ts`. Expect conflicts on:
  - the `unported_methods(Resolver.prototype, ..)` line (each lane deletes its own names);
  - possibly the three stub import lines this lane switched to value imports (`Session`, `Span`, `Symbol`).
  - If res-diag-b also imports any of `Span`, `Symbol`, `Session`, `Ident`, `kw`, `MultiSpan`, `DefId`, ... in its
    own block, deduplicate the imports after merging.
- After res-diag-b lands, take its cases off PENDING in `diagnostics/impls.test.ts`. The first should be
  `unresolved_import`; check the rest against the table above.
- Delete `docs/claims/` for res-diag-a on integration.
