# Handoff: res-late-diag-b (wave 10, M2: rustc_resolve late/diagnostics.rs, lines 2267–4872)

Branch `lane/res-late-diag-b` (from main 00f8a7b, no merges). Commits: the port; the tests; this handoff.

## Files
- `src/rustc_resolve/late/diagnostics.ts` (shared with res-late-diag-a, which owns lines 1–2266):
  - a `// res-late-diag-b imports` block after the stub's imports. Value imports that clash with the stub's
    `import type` names are aliased: `SpanC`, `IdentC`, `SegmentC`, `AstPath`, `AstPathSegment`, `AstTy`,
    `AstPolyTraitRef`, `TypoSuggestionC`, `SessionC`;
  - filled in place (stub positions): `ParentPathVisitor.new`, `mk_where_bound_predicate`,
    `signal_lifetime_shadowing`, `signal_label_shadowing`;
  - one appended block at the end of the file (after the `unported_methods` calls) with the 22
    `LateResolutionVisitor` methods, `likely_rust_type`, the nested `extract_node_id`, and the three
    `visit_ty` overrides, in upstream order;
  - the stub's `unported_methods(LateResolutionVisitor…)` list: my 22 names removed (the line still lists
    lane A's names). The three visitor `unported_methods(…, ["visit_ty"])` lines are deleted.
  - **Merge with res-late-diag-a:** expect conflicts on the `unported_methods` line (delete it once both
    lanes are in) and possibly on the import lines (both lanes need `Span`/`Ident`/`Segment` as values;
    merging into one import and dropping my aliases is fine).
- `src/rustc_resolve/late/diagnostics_b.test.ts` (new), `src/rustc_resolve/late/diagnostics_b_oracle/`
  (new: `gen.ts`, `expected.json`, `cases/*.rs`, 10 cases).

## Checks
- `bun scripts/coverage.ts --missing compiler/rustc_resolve/src/late/diagnostics.rs`: 31/69. **All 31 fns of
  2267..end are ported**; the 38 missing are lines 58–2223 (lane A).
- `bun scripts/coverage.ts --check`: `markers ok (6695; vendor 2603)`.
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 3397 pass, 1 skip, 0 fail.
- `RUST_TS_AGENT=res-late-diag-b bun scripts/difftest.ts --suite parse --sample 200`: 200/200 MATCH
  (run `20261013-133148-res-late-diag-b-28z5`). The parse suite does not reach this code.

## Tests (`diagnostics_b.test.ts`, 18 tests)
Oracle: the `resdump` probe's stderr + exit code (diagnostics up to name resolution) on each case with the
nocore arguments; `bun src/rustc_resolve/late/diagnostics_b_oracle/gen.ts` regenerates; a freshness test
re-runs it when the probe is built.

- **In process, byte for byte against the oracle's stderr (7 cases, all match):** the real `Resolver`
  (`macros_oracle/with_resolver.ts`), the session emitter redirected to a buffer, a `LateResolutionVisitor`
  whose lifetime ribs / `DiagMetadata` are set the way late.rs sets them where it calls into this file (each
  test cites the late.rs lines), then `print_error_count`.
  - `emit_undeclared_lifetime_error`: `e0261` (E0261 + "consider introducing lifetime"), `e0261_static`
    (the `'static` typo suggestion), `e0261_impl` (two suggestions: method generics, then `impl<'a, 'b>`
    through `span_through_char`).
  - `report_missing_lifetime_specifiers` / `add_missing_lifetime_specifiers_label`: `e0106_struct`
    (introduce a named lifetime parameter, multipart), `e0106_ret` (the `'static` help, then the
    owned-value suggestion `&[u8]` → `Vec<u8>` through `LifetimeFinder`).
  - `signal_label_shadowing` (`label_shadow`, warning + "1 warning emitted") and `signal_lifetime_shadowing`
    (`e0496`).
  - Test shim: `Resolver::dcx` (diagnostics/impls.rs:337, lane res-diag) is still a stub placeholder. While it
    is, the test installs its exact body (`this.tcx_.dcx()`) for the duration of a case, and restores it.
    Once res-diag lands, the shim is not installed.
- **End to end (10 cases, all PENDING):** `src/rust_ts/resdump.ts` vs the oracle. Today every case stops at
  `rust-ts: unported: rustc_lint::late::unerased_lint_store (pending lint-early-a)` (asserted, exit 70).
  After that they need expansion and late.rs (res-late-a/-b). The E0423/E0532 cases (`e0423_struct_call`:
  struct literal suggestion; `e0423_enum`: enum variant suggestion + notes; `e0532_unit`: "use this syntax
  instead") also need `smart_resolve_report_errors` (lane A) to build the base error.
  Remove the PENDING entry when a case runs through; it must then match byte for byte.

## `unported(...)` left
- `suggest_alternative_construction_methods` (extern `DefId`s only; local ones return first):
  - `rustc_middle::ty::AssocItems::in_definition_order (inherent impl items; fn_sig / ty::Adt, M3)`, reached per
    inherent impl. `associated_items` / `fn_sig` values are `unknown` in the query typemap.
  - `rustc_type_ir::fast_reject::SimplifiedType (implementations_of_trait value; M3)`, reached per
    `Default` impl with a simplified self type.
  - `DefId_get_attrs` for a local `DefId` (`find_attr!` on a local `Default` trait), as in lib.ts: HIR, M3.
- Indirectly, through other lanes' stubs: late.rs (`resolve_path`, `resolve_qpath_anywhere`,
  `is_label_valid_from_rib`, `RibKind::contains_params`, `PathSource::*`, `LifetimeBinderKind::descr`), lane A
  (`followed_by_brace`, `suggest_named_format_argument`, `update_err_for_private_tuple_struct_fields`),
  res-diag (`Resolver::dcx`, `struct_ctor`, `field_idents`, `def_span`, `TypoSuggestion::new`,
  `add_module_candidates`, `add_scope_set_candidates`, `lookup_import_candidates`, …).

## PORT decisions (please record)
1. **`MissingLifetimeKind`.** `rustc_hir::MissingLifetimeKind` (hir.rs:812) is not ported; `MissingLifetime.kind` is
   `unknown` (decls/typemap). A local `type MissingLifetimeKind = "Underscore" | "Ampersand" | "Comma" |
   "Brackets"` (PORTING §5 fieldless enum) is used and `lt.kind` is cast to it. The res-late lanes must create
   `MissingLifetime`s with these strings. Root: generate the hir enum and retype `kind`.
2. **`likely_rust_type`.** It is an associated fn without `self`. A local
   `declare module "../decls.ts" { namespace LateResolutionVisitor { let likely_rust_type } }` (marked
   `PORT(decls): pending root`) declares the static, and the fn is assigned to `LateResolutionVisitor.likely_rust_type`.
   Root: add `declare static likely_rust_type: (path: readonly Segment[]) => Symbol | undefined;` to the
   class in decls.ts and drop the local augmentation. Lane A should call it as `LateResolutionVisitor.likely_rust_type(path)`.
3. **`lookup_stability`.** Its value is `unknown` in the query typemap; it is cast to `Stability | undefined`
   (rustc_attr_ir::stability).
4. **`report_missing_lifetime_specifiers` / `add_missing_lifetime_specifiers_label`.** `impl Clone + IntoIterator`
   is materialised into an array once; every upstream `.clone()` re-reads it.
5. **`DefId_get_attrs`.** A local copy of lib.ts's stand-in (lib.ts does not export it). Root: export it from
   lib.ts (or port `impl HasAttrs for DefId`) and delete the copy.
6. **Local helpers.** `str_cmp` is the `String` `Ord` (the same as check_unused.ts's private one); `snippet_ok`
   is `span_to_snippet(..).ok()`. They are candidates for std.
7. **Option shapes.** `old_fields.get(idx)` (`Option<&Option<String>>`) uses the `{ $: "Some", _0 }` shape.
   `lookup_typo_candidate`'s mutable `ctxt` is a `MutRef<SyntaxContext>` for `SyntaxContext.remove_mark`.
8. **Placement.** The four stub entries were filled in place, so they sit before the appended block rather than
   in strict upstream order. Moving them would have touched lines next to lane A's stubs.

## For root
- decls.ts: add the `likely_rust_type` static (decision 2).
- rustc_hir: `MissingLifetimeKind` (decision 1); also `LifetimeRes::Fresh.kind` and the middle typemap.
- Delete `docs/claims/wave10-res-late-diag-b.md` on integration.
