# Handoff: res-diag-b (wave 10, M2: rustc_resolve diagnostics/impls.rs, lines 1978..4414)

Branch `lane/res-diag-b` (from main 00f8a7b, no merges). Commits: the port; two fidelity fixes plus the oracle
tests; this handoff.

## Files
- `src/rustc_resolve/diagnostics/impls.ts`. All edits are inside this lane's regions:
  - a `// res-diag-b imports` block, just before `export * from "./impls.gen.ts"`;
  - `UsePlacementFinder.check` filled in place. `visit_crate`, `visit_item` and `BindingVisitor.visit_pat` are
    assigned on the prototypes right after their classes;
  - the 24 `Resolver` methods (1978..3856) plus a few private helpers. They replace the free-fn stubs of
    `find_span_of_binding_until_next_binding` .. `show_candidates`, and the free fns follow in upstream order;
  - `search_for_any_use_in_items` and `is_span_suitable_for_use_injection` filled in place;
  - my 24 names removed from the `Resolver` `unported_methods(..)` list. The `UsePlacementFinder` and
    `BindingVisitor` `unported_methods` lines are deleted.
- New test `src/rustc_resolve/diagnostics/impls_b.test.ts`, with fixtures `impls_b_oracle/<case>.{rs,stderr}` (9 cases).
- No other file touched. decls.ts needed no change.

## Merge with res-diag-a (for root)
Expect three conflicts. All are trivial to resolve:
1. **Imports.** Both lanes add an import block at the same spot. Keep both blocks and dedupe any name both import.
   - My block imports `Span as SpanC`, `Symbol as SymbolC` and `Segment as SegmentC` to avoid touching the
     stub's `import type` lines.
2. **The shared `unported_methods(Resolver.prototype, ..)` line.** Each lane removes its own names. Take the
   intersection; if it is empty, delete the call.
3. **Method blocks.** Possibly an adjacent-insertion conflict where res-diag-a's methods end, just before my
   `// ---- lane res-diag-b: impl Resolver methods` header. Keep both blocks, a's first.

## Coverage
`bun scripts/coverage.ts --missing compiler/rustc_resolve/src/diagnostics/impls.rs` reports 37/61. All 36 fns in
1978..4414 are ported, including the nested `comes_from_same_module_for_glob`; the 37th is res-lib's `from_attrs`.
The 24 still missing are all res-diag-a's (lines 78..1898). `--check` reports `markers ok (6700; vendor 2603)`.

The brief also listed `lint_if_path_starts_with_module`, but it sits at impls.rs:699, inside res-diag-a's range
(1–1977). I left it to res-diag-a; it is still missing.

## Checks
- `bunx tsc --noEmit -p .` is clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools` gives 3391 pass, 1 skip, 0 fail.
- `--suite parse --sample 200` gives 200/200 MATCH (run `20261013-132916-res-diag-b-sdpv`).

## Tests (impls_b.test.ts, compared byte for byte with the oracle)
**Method.** Each case is parsed by the ported parser into a real session's source map. The session comes from the
`with_resolver` template, which gives a real `Resolver` and `tcx`, and the case is parsed under the relative name
rustc printed.
- The test builds the *outer* diagnostic as the upstream caller does: message, code and primary label, as
  `report_with_use_injections` + late diagnostics do for E0425, or `throw_unresolved_import_error` for E0432.
- It then calls the ported function with the inputs rustc computes (candidates, `TypoSuggestion`, `Import`).
- The ported `AnnotateSnippetEmitter` renders the diagnostic, and the test compares it with the oracle's block.

**Cases:**
- `show_candidates` + `UsePlacementFinder::check`:
  - crate root without `use` (FoundUse::No);
  - a module with a `use` (FoundUse::Yes);
  - a nested module's inject span, with "through its public re-export";
  - "if you import `Foo`, refer to it directly";
  - one inaccessible candidate (`span_note` "not accessible");
  - several inaccessible candidates (multi-span note).
- `add_typo_suggestion`:
  - a builtin type (`u3` -> `u32`);
  - the `x` -> `_x` rename note and suggestion.
- `check_for_module_export_macro` on four imports (nested, nested renamed, non-nested renamed, and a
  module-relative `pub(crate)` import that takes the indentation/vis branch). These exercise all three
  `find_span_*` helpers and `import_candidates` with `DiagMode::Normal` and no placement span.
- Direct `find_span_*` checks on the upstream doc examples.

**Freshness and controls.**
- A freshness test re-runs `rustc +nightly` (pin 6f5da406b) and requires the fixtures to be current.
  Regenerate with `REGEN=1 bun test src/rustc_resolve/diagnostics/impls_b.test.ts`.
- There is a negative control: a changed candidate is detected.
- A mutation of the `{import, start}` correction was caught.
- One known gap: the extra `"\n"` that `show_candidates` appends for FoundUse::No renders identically, so the
  human output cannot detect it.

**Scaffolding (test-only, not ports):**
- `NodeId`s for the `mod` items, which expansion normally assigns;
- `tcx.source_span` for the inaccessible cases, which the def collector normally feeds;
- a resolver, import and module stand-in for `check_for_module_export_macro`. Its `resolution` of the crate root
  yields a `macro_rules!` declaration.

**PENDING (end to end).** These are reached only once the pipeline runs (lint-early-a -> expansion -> late) or
through res-diag-a code:
- `unresolved_macro_suggestions` / `detect_derive_attribute`. They call `early_lookup_typo_candidate` and
  `lookup_import_candidates` (res-diag-a), and then reach
  `rustc_resolve::diagnostics::impls::Resolver::early_lookup_typo_candidate`.
- `report_privacy_error`, which reaches `rustc_resolve::diagnostics::impls::Resolver::dcx` (res-diag-a), then
  `lookup_import_candidates`.
- `report_path_resolution_error`, `find_similarly_named_module_or_crate`, `make_path_suggestion` /
  `make_missing_*`, `find_cfg_stripped`, `ambiguity_diagnostic` / `decl_description`, `ctor_fields_span`,
  `struct_ctor`, `on_unknown_data`. These need resolver state from build_reduced_graph and imports (callers in
  res-ident, res-imports and late).
  - Good end-to-end oracle cases are `fn f(_: b::Foo)` and `fn f(_: alpah::Foo)` next to `mod a` / `mod alpha`.
    They give E0433 "there is a crate or module with a similar name".

## `unported(...)` left
- None in my code.
- Reachable unported code in other owners:
  - `CStore.from_tcx` (wave 11), via `struct_ctor` for extern `DefId`s;
  - `tcx.attrs_for_def` / `tcx.stripped_cfg_items` for extern crates (metadata);
  - res-diag-a's `early_lookup_typo_candidate`, `lookup_import_candidates` and `dcx`;
  - late's `LateResolutionVisitor`. `resolve_ident_in_lexical_scope` (res-ident) is ported.

## PORT decisions (please record)
1. **`find_attr!` on extern ids.** `find_attr!(self.tcx, def_id, ..)` on a non-local `DefId` (`NonExhaustive`,
   `OnUnknown`) is `find_attr(tcx.attrs_for_def(def_id), ..)`. That is the extern branch of lib.ts's private
   `DefId_get_attrs`; the local branch is not reached, and `on_unknown_data` handles locals itself.
   - In `on_unknown_data`, the match boxes `{ directive }`, so a `None` directive still ends the search, as
     `find_attr!` + `?` + `as_deref` do upstream.
   - *Root:* consider exporting `DefId_get_attrs` from lib.ts.
2. **`ambiguity_diagnostic` closure capture.** The `extern_prelude_ambiguity` closure captures the pre-swap `b1`
   and `scope2`. Upstream shadows them with new bindings, so the closure keeps the originals.
3. **Owned `Vec<Segment>` paths.**
   - `make_path_suggestion` copies its `Vec<Segment>` (`clone_Segment`) because the callee owns it.
   - `path[0].ident.name = x` replaces the segment's `Ident` with `Ident.new(x, span)`, because `Ident`
     objects can be shared.
4. **Sort orders.**
   - `Symbol` `Ord` is index order (`a - b`): `find_similarly_named_module_or_crate`.
   - `as_str().cmp` and `into_sorted_stable_ord` of `Symbol` use `str_cmp` (rustc_session/options.ts,
     code-point order): `make_external_crate_suggestion`, `detect_derive_attribute`, `show_candidates`.
   - `sort_by_key` / `sort_by_cached_key` are a local stable keyed sort. `Vec::dedup` / `dedup_by` keep the
     first of each consecutive run. `extract_if` is a local order-preserving partition.
5. **Hash-map iteration.**
   - `detect_derive_attribute` iterates the `FxHashMap`s `local_macro_map` and `extern_macro_map`, but its
     output is sorted and deduplicated, so the order does not leak. The comment is kept.
   - `unused_macros`, `extern_prelude`, `local_module_map` and `extern_module_map` are `FxIndexMap`s, so JS
     `Map` order is exact.
6. **Small helpers.**
   - `rsplit(c).collect()` is `split(c).reverse()`.
   - Byte lengths use `utf8_len`.
   - `vis.trim().is_empty()` uses `str_trim_start` / `str_trim_end` on the `Str` snippet.
   - `char::is_ascii_uppercase` of the first char is a code-unit range test; a surrogate is never A–Z.
7. **`undeclared_module_exists`.** It uses std/path.ts (`path_parent`, `path_file_stem`, `path_join`),
   rustc_session's `path_set_extension` (for `with_extension`) and `node:fs` `existsSync`. `path.display()` is
   the string itself.
8. **Tracing.** `#[instrument]` and `debug!` are dropped, with a comment.
9. **Visitors.** `UsePlacementFinder` / `BindingVisitor` visitor methods are prototype assignments, like
   check_unused.ts. They return `undefined`, the `Visitor<undefined>` result.

## For root
- Resolve the merge with res-diag-a as described above. After that, `--missing` for impls.rs should reach 61/61
  once res-diag-a's 24 fns land.
- Record the PORT decisions.
- Delete `docs/claims/wave10-res-diag-b.md` on integration.
