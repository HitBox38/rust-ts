# Handoff: thir-pattern (M3 wave 18): THIR pattern lowering, rustc_mir_build diagnostics, THIR Debug gaps

Branch `lane/thir-pattern`, from `integ` 3edec71. Commits bd730a0..ca056a5 (+ this handoff). No baselines, suites,
oracle outputs, `harness/`, `scripts/`, `UPSTREAM.json`, or codegen tool source touched. No files of the parallel lanes
were edited (`src/rustc_hir_typeck`, rustc_trait_selection traits/*, rustc_traits, obligation_forest,
rustc_codegen_ssa, small rustc_middle/hir_analysis stops). Regenerating their sets (rustc_trait_selection_traits_a,
rustc_hir_analysis, rustc_infer) after the type-map edits produced no diff.

## Summary
- `thir/pattern/{mod,migration,const_to_pat}.rs` are fully ported. `check_match.rs` is still a stub: it needs
  rustc_pattern_analysis. Its "how to fill" guide moved from mod.ts into check_match.ts's header.
- New codegen set `rustc_mir_build` covers diagnostics.rs: 95 derives. The 4 manual impls are ported in
  `src/rustc_mir_build/diagnostics.ts`.
- cx/expr.ts now emits the real `ConstContinueMissingLabelOrValue` and `LoopMatch{MissingAssignment,BadStatements,
  BadRhs,InvalidMatch,InvalidUpdate}` fatal errors.
- THIR Debug gaps closed:
  - `op`, `borrow_kind` and `fake_reads` cause: these come from the new partial `rustc_middle/mir/syntax.ts`
    (codegen set `rustc_middle_mir_syntax`).
  - Also closed: `user_ty` (Canonical, including `var_kinds`), `variant_index`, `name`/`field`, `Literal.lit`,
    `ConstParam.param`, `adt_def` and `PatRangeBoundary::Finite`.
  - Still open in thir.gen.ts: Debug of `StaticRef.alloc_id` and `InlineAsmOperand::Const.value` (both M4).
- Suites unchanged: nothing reaches `thir_body` yet. **No new DIFF.**

## Files touched
- **Ported (rustc_mir_build):**
  - `thir/pattern/mod.ts`, `migration.ts`, `const_to_pat.ts`: the stubs replaced by the ports.
  - `diagnostics.ts` (new): manual impls plus `export *` of `diagnostics.gen.ts` (new, generated).
- **Edited (rustc_mir_build):**
  - `thir/cx/expr.ts`: diagnostics. Its `Mir*` stand-in aliases are repointed to `rustc_middle/mir/syntax.ts`
    (`BinOp.Add`, ...), and the closure fake-read cause is cast to `FakeReadCause` (see PORT 10).
  - `thir/print.ts`: the `debug_mir_*` stand-ins are replaced by the generated Debug fns (`FakeReadCause` included).
  - `thir/pattern/check_match.ts`: header only.
  - `lib.ts`: comment only.
- **Tests:** `thir/pattern/pattern.test.ts` (new).
- **rustc_middle additions (minimal):**
  - `mir/syntax.ts` (new hand module, `export *`) and `mir/syntax.gen.ts` (generated): only `BorrowKind`,
    `MutBorrowKind`, `FakeBorrowKind`, `FakeReadCause`, `UnOp`, `BinOp`, `AssignOp`. Every other type of
    mir/syntax.rs is in the set's `skip` list until M4.
  - `ty/list.ts`: `debug_CanonicalVarKinds`, a hand alias like `debug_BoundVarKinds`.
  - Regenerated: `thir.gen.ts` and `rustc_type_ir/canonical.gen.ts` (`var_kinds` Debug).
- **tools/codegen (JSON only):**
  - `types.sets.json`: appended sets `rustc_mir_build` and `rustc_middle_mir_syntax`.
  - `mir_build.typemap.json` (new): `RustcPatCtxt` mapped to `unknown`.
  - `middle_traits_thir.typemap.json`:
    - helpers: `debug_Canonical`, `debug_Spanned`, `debug_LitKind`, `debug_AdtDef`, `debug_ParamConst`;
    - entries: `hir::Lit`, `ParamConst`, `CanonicalUserType` (Debug, clone copy), `CanonicalUserTypeAnnotation`
      clone, mir `FakeReadCause`/`AssignOp`/`BorrowKind`/`BinOp`/`UnOp`, `FieldIdx`/`VariantIdx` (`{}`: a plain
      number), `AdtDef`, `ValTree`. These are set-local overrides of tyir.typemap.json.
  - `tyir.typemap.json`: `I::CanonicalVarKinds` Debug now uses `debug_CanonicalVarKinds` (list.ts helper).

## Coverage (`bun scripts/coverage.ts --missing ...`)
| file | |
|---|---|
| thir/pattern/mod.rs | 14/14 |
| thir/pattern/migration.rs | 8/8 |
| thir/pattern/const_to_pat.rs | 10/10 |
| thir/pattern/check_match.rs | 0/34 (stub, rustc_pattern_analysis lane) |
| diagnostics.rs | 4/4 |
| thir/cx/expr.rs, thir/print.rs | 27/27, 23/23 (unchanged) |

`bun scripts/coverage.ts --check`: markers ok (15084; vendor 3888).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun test src/rustc_mir_build src/rustc_middle --timeout=60000`: 264 pass, 0 fail. `src/rustc_type_ir` also passes.
- `pattern.test.ts` compares against upstream `tests/ui/thir-print/str-patterns.stdout`, at the nesting depth used
  there. Both tests pass:
  - The `"hello"` arm: `lit_to_const` (constant.rs), then `Const::new_value` at the pattern's type, then
    `PatCtxt::const_to_pat`. The result is `Deref` of a `str` `Constant` with the `Branch([104_u8, ..])` valtree.
  - `CONSTANT`'s `e0`: `ExprKind::Literal` Debug, which uses the new `hir::Lit` (`Spanned { node: Str(..), span }`)
    entry.
- Samples (`RUST_TS_AGENT=thir-pattern`):

  | suite | result | base | run |
  |---|---|---|---|
  | thirdump-minicore (full, 46) | 5 MATCH / 0 DIFF / 41 UNPORTED | 5/0/41 | 20261015-080439-thir-pattern-q9r8 |
  | tydump-minicore (full, 46) | 5 MATCH / 0 DIFF / 41 UNPORTED | 5/0/41 | 20261015-080457-thir-pattern-zn9a |
  | hir-tree-nocore `--sample 100 --seed thirpat` | 99 MATCH / 0 DIFF / 1 UNPORTED | no DIFF | 20261015-080511-thir-pattern-z4qx |

  thirdump stops are unchanged:
  - 27: `FulfillmentContext::new` (old solver);
  - 8: `codegen_fn_attrs`;
  - 3: `check_unused_traits`;
  - 2: StableHash;
  - 1: `Decodable for TraitDef`.

## Every `unported(...)` left (this lane's files)
- **mod.ts:** `IntegerExt::from_int_ty` / `from_uint_ty` (rustc_middle ty/layout.rs, M4). These are module-level
  stand-ins like thir.ts's, used by `error_on_literal_overflow`, so only malformed int ranges reach them.
- **const_to_pat.ts:**
  - `TyCtxt::const_eval_resolve_for_typeck` (mir/interpret, M4): `alias_to_pat` of non-direct consts. Note that
    `erase_and_anonymize_regions` (erase_regions.ts, a stub) is reached first in `alias_to_pat`, so every named
    constant pattern stops in a dependency for now.
  - `compute_applicable_impls_for_diagnostics` (rustc_trait_selection error_reporting/traits/ambiguity.rs, not
    ported): `type_has_partial_eq_impl`.
  - `ScalarInt::to_f16/32/64/128`: rustc_apfloat; already unported in int.ts. Float constant patterns stop there.
- **diagnostics.ts:** none. `PatternNotCovered` is not generated (skipped in the set; see below).
- **cx/expr.ts:** unchanged except that the diagnostic stops are gone. Remaining: asm `const` operand
  (`mir::Const`), static alloc (`reserve_and_set_static_alloc`), `Debug for UpvarId`.
- **thir.gen.ts (generated):**
  - Debug of `alloc_id` and `InlineAsmOperand::Const.value`, and Clone of `.value` (M4).
  - `unported_type_fold` for `Ascription.annotation` (`CanonicalUserTypeAnnotation`) and `PatRangeBoundary::Finite`
    (`ValTree`): type_fold.json has no entry, because their impls are a hand descriptor (`fold_ValTree`) or absent.
    No ported code visits patterns with ascriptions or ranges: `references_error` only runs on `valtree_to_pat`
    output.
- **check_match.ts:** the whole stub.

## `// PORT:` decisions
1. **`deref_pat_borrow_mode`** (mod.ts helper): typeck_results.ts returns its pending `DerefPatBorrowMode`, which is
   built in thir.rs's shape. It is cast to rustc_middle thir's type.
2. **`extra_get_or_insert_default`** (mod.ts) is `pat.extra.get_or_insert_default()` (`PatExtra: Default`).
3. **`alias_to_pat`'s `match const_eval_resolve_for_typeck(..)`** is ported in the helper `alias_to_pat_eval_result`
   over a PORTING §5 shape of `EvalToValTreeResult` / `ErrorHandled`. It is called with the M4 `unported(..)`, so it
   is ready when const eval lands.
4. **`d_TypingEnv`** (const_to_pat.ts): a local TypeFoldable descriptor of `ty::TypingEnv`, whose derive is not
   generated. `typing_mode` is identity and `param_env` folds.
5. **`CandidateSource` / `compute_applicable_impls_for_diagnostics`** are local stand-ins (unported) until the
   ambiguity.rs port.
6. **`ScalarInt::to_f*()` results** are cast to `{ is_nan() }`: int.ts types them `never`.
7. **`UsedParamsNeedInstantiationVisitor`** is a local class (TypeVisitor, provided methods delegated). The sets are
   JS `Set`s in insertion order; the labels are sorted by rendering, as upstream notes. `manual`/`without` are
   sorted with a `<` comparator, which is UTF-16 order: it differs from Rust's byte order only for astral vs.
   U+E000+ characters.
8. **`RustcPatCtxtView`** (diagnostics.ts): `NonExhaustivePatternsTypeNotEmpty.cx` is rustc_pattern_analysis's
   `RustcPatCtxt` (`unknown`). Its into_diag reads `tcx` / `module` / `typing_env` through this view.
9. **`PatMigration.default_mode_labels`** (`FxIndexMap<Span, Mutability>`) is a `Map` keyed by `Span`, in insertion
   order. `.into_iter().rev()` is `[...map].reverse()`.
10. **cx/expr.ts `fake_reads`:** typeck_results.ts types the cause as pending (`unknown`); it is cast to mir/syntax.ts's
    `FakeReadCause`.

## For root
- **decls.ts (root-owned)** still has `BinOp`/`UnOp = Pending<"mir::...">` (tyir.typemap.json maps them there for
  the other sets). thir.gen.ts now uses mir/syntax.ts's real types through the set-local override. Consider
  repointing decls.ts's `BinOp`/`UnOp` to `../mir/syntax.ts` and the tyir.typemap.json entries with it.
- **typeck_results.ts** (lane ty-results) could type `DerefPatBorrowMode` and the fake-read `FakeReadCause` as the
  thir.gen.ts / mir/syntax.ts types, which would remove PORT 1 and 10.
- **The `rustc_middle_mir_syntax` set** is deliberately partial (`skip` + `files_note`). The MIR lane (M4) drops
  the skip list and ports mir/syntax.rs's fns into `mir/syntax.ts`.
- **When check_match lands:** drop the `PatternNotCovered` skip in set `rustc_mir_build` and add a type-map entry
  (with `subdiagnostic`) for `rustc_pattern_analysis::diagnostics::Uncovered`.
- **Still blocking THIR output:** the typeck/old-solver stops above. Inside pattern lowering, named constants also
  need `erase_and_anonymize_regions` (erase_regions.ts) and const eval (M4), and range patterns of signed/unsigned
  ints need `IntegerExt` (ty/layout.rs) only on the error path.
