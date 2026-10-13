# Handoff: merge-late (fixer; integrate res-late-b, res-late-diag-a, res-late-diag-b into `integ`)

Three merge commits on `integ`:
- `c9235f8`: lane/res-late-b
- `52ff605`: lane/res-late-diag-a
- `c439114`: lane/res-late-diag-b

Nothing was pushed, and no other lane was merged.

## Result
- `bun scripts/coverage.ts --missing compiler/rustc_resolve/src/late.rs`: **142/142 ported**.
  `.../late/diagnostics.rs`: **69/69 ported**. No duplicate markers.
- `bun scripts/coverage.ts --check`: `markers ok (7209; vendor 2603)`.
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 3513 pass, 1 skip (pre-existing), 0 fail.
- `--suite parse --sample 200`: 200/200 MATCH (run `20261013-135934-merge-late-or5e`).
- `--suite expanded-nocore --sample 300`: 7 MATCH, 0 DIFF, 293 UNPORTED, 0 CRASH, 3 skipped
  (run `20261013-135944-merge-late-bafh`). Stop points from the jsonl `unported` field:
  - 267 `rustc_metadata::creader::CStore::from_tcx (wave 11)`
  - 26 `rustc_metadata::creader::CStore::from_tcx_mut (wave 11)`

## Conflicts and resolutions

### 1. res-late-b (late.rs)
- **`LateResolutionVisitor::new`.**
  - Kept: the `declare static new` in decls.ts (from res-late-b) and res-late-a's implementation, assigned as
    `LateResolutionVisitor.new = ...`.
  - Dropped: res-late-a's companion `const LateResolutionVisitor = decls.LateResolutionVisitor as ... & { new }`
    and res-late-b's guarded `unported` placeholder.
  - late.ts re-exports the decls class (`export { LateResolutionVisitor }`), as the stub did.
- **`PatternBindings`, fixed at the root in codegen.**
  - `tools/codegen/types.ts` `typeArgs` now reads `SmallVec<[T; N]>` as `SmallVec<T>`: a `SmallVec` whose only type
    argument is an array uses the element type. This affects ts, debug, clone and every other typemap expansion.
  - I regenerated every set. The only generated change is late.gen.ts:
    `PatternBindings = ([PatBoundCtx, Map<Ident, Res>])[]`.
  - Dropped both workarounds: res-late-a's double cast in `resolve_fn_params`, and res-late-b's local
    `export type PatternBindings`. decls.ts imports it from late.gen.ts again.
  - A stray `src/rustc_lexer/lib.gen.ts` that the rustc_lexer set writes was deleted; it is not part of the tree.
- **Duplicate helpers.** `index_map` and `LifetimeRes_eq` were in both halves; I kept res-late-a's (same logic).
  res-late-b's other helpers are unique and stay: `assign_map`, `extend_map`, `retain`, `PrimTy_from_name`,
  `RES_ERR`.
- **`Segment`** is now a value import from lib.ts; res-late-b uses its companion.
- **`unported_methods`.** All 111 names had real prototype assignments, so I deleted the call and its import.
- **Tests.**
  - `late_a.test.ts`:
    - `resolve_fn_signature` is off UNIT_PENDING; it runs through.
    - `future_proof_import` now asserts that exactly one error is emitted (`ImportsCannotReferTo`) and that the
      session then aborts.
    - The stale stop points moved forward (and later cleared, see section 3).
  - `late_b.test.ts`:
    - The `REPORT_ERROR` stop expectations became `reports(v, f)` error counts, now that `Resolver::report_error`
      is ported (res-diag): E0416 = 1, E0408 = 2, never-pattern binding = 1, `check_consistent_bindings` = 2.
    - The three tests that report run under `with_visitor_reporting`, which expects the end-of-session
      `FatalErrorMarker` only after the body has completed.
    - `with_generic_param_rib([pt, pt])` now expects E0403 and then `record_partial_res`'s "path resolved multiple
      times" panic. The same `NodeId` twice panics upstream too.
    - The `ItemInfoCollector` test runs just the collector step of `late_resolve_crate`:
      `with_owner(CRATE_NODE_ID)` + `walk_crate`. The full call stopped inside an owner and left that owner
      out of `owners`.

### 2. res-late-diag-a (late/diagnostics.ts): clean textual merge
- decls.ts gained `declare static likely_rust_type: (path: readonly Segment[]) => Symbol | undefined;`, and
  diag-a's cast at the call site was removed.
- lib.ts now **exports `DefId_get_attrs`**, and the copies were dropped:
  - res-diag-b's `DefId_get_attrs_extern` in diagnostics/impls.ts;
  - diag-a's direct `tcx.attrs_for_def` read in `lookup_doc_alias_name`;
  - (in step 3) res-late-diag-b's copy.
- **Tests (`late/diagnostics.test.ts`).**
  - The hand-made visitor with empty ribs is now `LateResolutionVisitor.new(r)` plus the `diag_metadata`
    override. Empty ribs hit `resolve_ident_in_lexical_scope`'s `unreachable!()`, since a real visitor always has
    the module rib.
  - All three CASE_PENDING cases now pass their full expectations, including the two rendered byte-for-byte
    oracle blocks.
  - The driver cases now stop at `CStore::from_tcx (wave 11)`.
  - `late_a`'s `visit_ty: a path type` used a path with zero segments, which the parser never produces and
    upstream `path.last().unwrap()` panics on. It now resolves a real `u8` path and asserts the `PrimTy`
    partial res.

### 3. res-late-diag-b (late/diagnostics.ts): 5 conflict hunks, file rebuilt from both sides
- **Imports.** One header. Diag-b's block follows diag-a's block, and names both blocks imported were removed
  from diag-b's.
  - Diag-b's aliases (`SpanC`, `IdentC`, `SegmentC`, `AstPath`, `AstPathSegment`, `AstPolyTraitRef`, `AstTy`,
    `TypoSuggestionC`, `SessionC`) were replaced by the plain names.
  - The header's `Path` / `PathSegment` / `PolyTraitRef` / `Ty` / `Session` / `Applicability` imports became
    value imports.
- **In-place stub fills.** Diag-b filled `ParentPathVisitor.new`, `mk_where_bound_predicate`,
  `signal_lifetime_shadowing` and `signal_label_shadowing`. Diag-a's fills are untouched.
- **Body.** Diag-b's appended block comes after diag-a's region. All four `unported_methods` calls are gone:
  every method of both halves is ported, and the three `visit_ty` overrides are in.
- **Dropped from diag-b's block:**
  - the `declare module` augmentation for `likely_rust_type`; it is now assigned to the decls.ts static;
  - the local `MissingLifetimeKind`, now imported (type-only) from late.ts, which exports res-late-a's;
  - the local `str_cmp`, superseded by diag-a's (same code-point order);
  - the local `DefId_get_attrs`, now the lib.ts export.
- **Tests.**
  - `late_a.test.ts`: UNIT_PENDING is empty.
    - The undeclared-lifetime, const-param-type-rib and Item-barrier cases assert 1 emitted error each through
      `errors_reported`.
    - `resolve_label` with an unreachable label asserts the exact `Err(UnreachableLabel { .. })`.
  - `late_b.test.ts`: **PENDING_IN_PROCESS is empty. All 4 in-process cases (patterns, labels, traits, errors)
    match the probe** on every compared section. The harness now runs like the probe: cwd = `late_b_oracle`
    and the bare file name, so spans print `labels.rs:..`. For `errors` (probe exit 1), the end-of-session
    `FatalErrorMarker` after the dump is accepted.
  - `late/diagnostics_b.test.ts`: the driver stop is now `CStore::from_tcx (wave 11)`.

## PORT decisions (please record)
1. codegen `typeArgs`: `smallvec::SmallVec<[T; N]>` maps as `SmallVec<T>` (element type), fixing
   `PatternBindings` (and any future SmallVec field).
2. `LateResolutionVisitor::new` and `::likely_rust_type` are `declare static` on the decls.ts class, assigned
   once in late.ts and late/diagnostics.ts. There are no companions or augmentations.
3. `DefId_get_attrs` (the `impl HasAttrs for DefId` stand-in) is exported from rustc_resolve lib.ts, and there
   are no local copies.

## Left for root / notes
- `late_b.test.ts` still carries res-late-b's `STAND_INS`. They are inert: each is installed only while the real
  function is the `unported` stub, which is never the case now. Root can delete them.
- Running `late_b.test.ts` alone fails its fixture-freshness test with "probe missing". This predates this
  merge. `bun test` does not load `.env.local`, and the file reads `RUST_TS_DATA` without importing
  `scripts/lib/common.ts`. Whole-directory runs pass, because another test file loads it first.
- Still PENDING: the driver oracle cases in late_a, late_b, late/diagnostics and diagnostics_b. All of them stop
  at `CStore::from_tcx` (wave 11).
