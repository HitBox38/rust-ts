# Handoff: res-late-b (wave 10, M2: rustc_resolve late.rs lines 2891–end)

Branch `lane/res-late-b` (from main 00f8a7b, no merges). Commits: the port; tests + the guarded `new` stub; this handoff.

## Files
- `src/rustc_resolve/late.ts`
  - `required_generic_args_suggestion` (late.rs:5741) and `def_id_matches_path` (late.rs:5864) are filled in place, at
    the top where the stub had them.
  - Everything else is appended **after** the stub's `unported_methods(..)` lines, in upstream order:
    - all `LateResolutionVisitor` methods from `resolve_item` (2891) to `resolve_eii` (5712);
    - `ItemInfoCollector::{collect_fn_info, visit_item, visit_assoc_item}`;
    - `Resolver::late_resolve_crate`.
  - New imports are one block commented `// res-late-b imports`, placed after the `./decls.ts` import.
  - The stub's `ItemInfoCollector` and `Resolver` `unported_methods` calls are deleted.
  - **The shared `LateResolutionVisitor` list line is left untouched.** res-late-a edits the same line. My prototype
    assignments come after it and replace its (writable) placeholders.
- `src/rustc_resolve/decls.ts` (root's; minimal):
  1. `PatternBindings` is now imported from `./late.ts`, not `./late.gen.ts` (see PORT 2).
  2. `LateResolutionVisitor` gets `declare static new: (resolver: Resolver) => LateResolutionVisitor;`. It mirrors
     `Resolver`'s `declare static new`, and `late_resolve_crate` needs it. res-late-a likely adds the same line.
- New: `src/rustc_resolve/late_b.test.ts`, `src/rustc_resolve/late_b_oracle/{patterns,labels,traits,errors,units}.rs`,
  the probe fixtures `<case>.resdump.{stdout,stderr}` and `exit_codes.json`.

## Checks
- `bun scripts/coverage.ts --missing compiler/rustc_resolve/src/late.rs`: 65/142. All 65 fns from line 2891 on are
  ported; the 77 missing ones are all below 2891 (res-late-a).
- `bun scripts/coverage.ts --check`: `markers ok (6729; vendor 2603)`.
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 3403 pass, 1 skip, 0 fail.
- `--suite parse --sample 200`: 200/200 MATCH (run `20261013-133611-res-late-b-vh4d`).

## Tests (`late_b.test.ts`, 24 tests)
1. **Oracle cases.** `#![no_core]` crates with the resdump-nocore args (`graph_oracle/args.ts`):
   - `patterns`: bindings, or-patterns, struct/tuple-struct/path patterns, `..`, guards, unit structs and consts in
     patterns, fn params.
   - `labels`: label_res, two UNUSED_LABELS lints, an underscore label, the label-shadowing warning.
   - `traits`: trait_map, Self, qpaths, assoc consts/types, generics, consts/statics, closures, inline const, repeat.
   - `errors`: E0201, E0407, E0323, E0325, E0403, E0415, E0408, E0416, E0409, E0530.

   How they run:
   - The fixtures are regenerated with `REGEN=1`. A freshness test re-runs the probe, and a guard test checks each
     fixture still contains what it is named for.
   - **In process** (as build_reduced_graph.test.ts: `Resolver::new` + expansion, then `late_resolve_crate`): compares
     `partial_res_map`, each owner's `label_res` / `trait_map` / `extra_lifetime_params` and `lint_buffer`.
     **PENDING, all 4:** they stop at `rustc_resolve::late::LateResolutionVisitor::new`, which is res-late-a's.
     `ItemInfoCollector` has already walked each crate by then.
   - **Through the driver** (src/rust_ts/resdump.ts): **PENDING, all 4.** The driver exits 70 at
     `rustc_lint::late::unerased_lint_store` (lint-early-a), before resolution.
2. **Unit checks** on a real `Resolver` built from `units.rs`. Test stand-ins (upstream bodies) are installed only while
   the real function is still the stub: `LateResolutionVisitor::new`, `Rib::new`, `LifetimeRib::new`, `with_rib`,
   `with_lifetime_rib`, `LifetimeRibKind::elided`, `ConstantHasGenerics::force_yes_if`, `record_lifetime_def`,
   `record_lifetime_err`. What they cover:
   - `required_generic_args_suggestion`, `ItemInfoCollector` (lifetime counts, `has_self`, assoc-type suggestions) and
     `def_id_matches_path`;
   - `fresh_binding`, both binding-map fns, `check_consistent_bindings`, `apply_pattern_bindings` and
     `record_patterns_with_skipped_bindings`;
   - `fill_delegation_inherent_fn_map`, `with_generic_param_rib`, `with_constant_rib` / `resolve_anon_const_manual`,
     `resolve_block`, `resolve_qpath` (`<T>::B`), the self ribs and helpers, and the early outs of doc links and
     `lint_unused_qualifications`.
   - Error paths are asserted to stop at `rustc_resolve::diagnostics::impls::Resolver::report_error` (res-diag).
   - Negative control: flipping the or-pattern reuse in `fresh_binding`, or the repeat-expr `force_yes_if`, fails 2 tests.

## `unported(...)` left
- Mine: only the guarded `LateResolutionVisitor::new` placeholder (see PORT 4). Everything else in my range is ported.
- **Reached through other lanes' stubs:**
  - **res-late-a:**
    - `new`, `as_mut` (via `with_owner`), `with_rib`, `with_lifetime_rib`, `Rib::new`, `LifetimeRib::new`;
    - `LifetimeRibKind::elided`, `ConstantHasGenerics::force_yes_if`, `MaybeExported::eval`;
    - `PathSource::{namespace, defer_to_typeck, is_call, is_expected}`;
    - `resolve_path`, `maybe_resolve_ident_in_lexical_scope`, `resolve_ident_in_lexical_scope`, `resolve_label`;
    - `record_lifetime_def` / `record_lifetime_err`, `resolve_elided_lifetimes_in_path`, `resolve_adt`,
      `future_proof_import`, and the `visit_*` overrides.
  - **res-late-diag:** `signal_lifetime_shadowing`, `signal_label_shadowing`, `maybe_report_lifetime_uses` (every `fn`),
    `smart_resolve_report_errors`, `suggest_adding_generic_parameter`, `find_similarly_named_assoc_item`.
  - **res-diag:** `Resolver::{report_error, dcx, into_struct_error}`.
  - **rustdoc:** `has_primitive_or_keyword_or_attribute_docs` and `attrs_to_preprocessed_links`. With rustc's default
    `ExportedMetadata`, only crates whose type has metadata reach them.

## PORT decisions (please record)
1. **Placement.**
   - The methods come after the stub's `unported_methods(LateResolutionVisitor.prototype, ..)` call and override its
     placeholders. That shared line is left to res-late-a, so the two halves merge textually.
   - **At integration**, drop my 65 names from that list, or delete the call once both halves are in.
2. **`PatternBindings`.** late.gen.ts generates `T[][]`, because the typemap maps `SmallVec<[T; 1]>` through the
   array type. late.ts exports the upstream shape `[PatBoundCtx, Map<Ident, Res>][]`, which shadows the
   `export *`. decls.ts imports it from there.
   - Root follow-up: fix the `smallvec::SmallVec` typemap entry in tools/codegen.
3. **`LateResolutionVisitor.new`.** Declared as `declare static new` in decls.ts (decls change 2).
4. **Guarded `new` stub.**
   - The res-lib stub had no placeholder for `new`, so the call was a `TypeError`. My region installs
     `unported("rustc_resolve::late::LateResolutionVisitor::new")` only if `new` is not already an own property.
     That way it never replaces res-late-a's real `new`, whichever runs first.
   - Delete it once res-late-a lands.
5. **Rib bindings.**
   - `*rib_bindings = map` (`apply_pattern_bindings`, guard patterns) becomes `assign_map`, which replaces the rib map's
     contents in place.
   - `FxIndexMap::extend` becomes `extend_map`.
   - Every locally built map or set keyed by `Ident` / `DefId` is a `KeyedMap` / `KeyedSet`:
     `seen_bindings`, `seen_lifetimes`, binding maps, `PatternBindings`, `seen_trait_items`,
     `delegation_inherent_fn_map` entries.
6. **By-value `mut ident` / `mut reported_ident`** in `check_trait_item` are fresh `Ident` copies, adjusted through
   `field_mut`, so the AST's idents are never edited.
7. **`hir::PrimTy::from_name`** (hir.rs:3381, M3) is a marker-less local copy, like lib.ts's `PrimTy_ALL` /
   `PrimTy_name`.
8. **`LifetimeRes`'s derived `PartialEq`** is a local `LifetimeRes_eq` (`ErrorGuaranteed` compares always equal).
9. **Small mappings.**
   - `Diag` field access through `DerefMut` is `.deref_mut()`; `take` / `append` / `swap` are spelled out.
   - `unused_labels.swap_remove` uses rustc_errors' `index_map_swap_remove`, which keeps IndexMap order exact for the
     UNUSED_LABELS buffering.
   - `privacy_errors.truncate(n)` becomes a guarded `length = n`.
   - `def_id_matches_path`'s `rev()` iterator becomes a decrementing index; it still consumes a step even when there
     is no parent, as the tuple `while let` does.
10. **Import block.** It may duplicate names that res-late-a also imports (`Ident`, `PartialRes`, `Span`, ...). Those
    merge textually; tsc then flags each duplicate for a one-line dedup.

## For root
- At integration with res-late-a:
  - drop my names from the `unported_methods` list (PORT 1);
  - delete the guarded `new` stub (PORT 4);
  - dedup the imports (PORT 10);
  - take the identical `declare static new` once.
- Then update `late_b.test.ts` PENDING:
  - **In process:** the next stops should be in late/diagnostics or diagnostics.
  - **Driver:** stays PENDING until lint-early-a lands.
  - Once a case runs, compare it as written.
- Fix the `SmallVec<[T; N]>` typemap (PORT 2).
- Delete `docs/claims/wave10-res-late-b.md` on integration.
