# Handoff: lint-early-b (wave 10, M2: rustc_lint early lint passes)

Branch `lane/lint-early-b`, based on c991cbe. No merges.

## Result
Every pass of `BuiltinCombinedEarlyLintPass` (lib.rs:176) and of `InternalCombinedEarlyLintPass` (registered with
`-Zunstable-options`) is ported: all early `check_*` methods and the helpers they use, in upstream order, with markers.
The late passes in the same modules stay `unported_methods` placeholders (M3).

The real driver does not reach the early lints yet: `configure_and_expand` stops at
`rustc_metadata::creader::CStore::from_tcx (wave 11)` before `early_lint_checks`. The passes are tested through a new
test driver, `src/rust_ts/earlylints.ts`. It works like lint-early-a's `lintlevels.ts` (crate root, then the pre-expansion
and early `check_ast_node`), but it first gives every AST node a fresh `NodeId`, as `InvocationCollector` does. Without
that, UnusedParens (`parens_in_cast_in_lt`, `in_no_bounds_pos`) and EllipsisInclusiveRangePatterns see a single
`DUMMY_NODE_ID` everywhere. That was confirmed on tests/ui/lint/unused/unused-parens-issue-106413.rs, which matches
with fresh ids and does not match without them.

## Files
- **Ported (hand):**
  - `src/rustc_lint/builtin.ts`: WhileTrue, UnsafeCode (+`report_unsafe`), AnonymousParameters, `warn_if_doc` +
    UnusedDocComment, DoubleNegations, `soft::lint_vec`, EllipsisInclusiveRangePatterns (+`matches_ellipsis_pat`),
    IncompleteInternalFeatures (+`HAS_MIN_FEATURES`), SpecialModuleName. KeywordIdents was already ported.
  - `src/rustc_lint/unused.ts`: `UnusedDelimsCtx` + `From`, the `UnusedDelimLint` trait (required methods and all 9
    provided ones), `NoBoundsException`, UnusedParens (whole impl), UnusedBraces, UnusedImportBraces (+`check_use_tree`).
  - `src/rustc_lint/nonstandard_style.ts`: `char_has_case`, `changes_when_titlecased`, `not_camel_case`,
    `is_upper_camel_case`, `to_upper_camel_case`, NonCamelCaseTypes (`check_case` and 4 `check_*`).
  - `precedence.ts`, `redundant_semicolon.ts`, `macro_expr_fragment_specifier_2024_migration.ts`, `non_ascii_idents.ts`:
    complete.
  - `src/rustc_lint/internal.ts`: LintPassImpl, ImplicitSysrootCrateImport (+`is_whitelisted`), BadUseOfFindAttr
    (+`path_contains_attribute_kind`, `find_attr_kind_in_pat`).
- **Vendored (new crates):**
  - `src/vendor/unicode_script/`: `lib.ts` (all of lib.rs; benches are `crate-skip`), `lib.test.ts` (its 3 tests),
    `tables.ts` (GENERATED).
  - `src/vendor/unicode_security/`: `lib.ts`, `general_security_profile.ts`, `confusable_detection.ts`, `mixed_script.ts`,
    `restriction_level.ts`, `tests.test.ts` (its 6 tests), `tables.ts` (GENERATED).
  - Both `tables.ts` come from the crates' own `src/tables.rs` (locked versions), produced by
    `$RUST_TS_DATA/tmp/lint-early-b/scripts/gen-unicode-security.ts <repo> [--check]`, which follows
    tools/gen-unicode-normalization.ts. Porting lanes may not add tools. **Root: move it to `tools/gen-unicode-security.ts`**
    (and fix the `REG`/`Cargo.lock` lookups to use `scripts/crate-src.ts` `crateSrc`/`lockedVersion`).
- **Tests and test driver (new):** `src/rustc_lint/early_passes.oracle.test.ts` (19 oracle scenarios),
  `src/rust_ts/earlylints.ts`.
- **Changed, owned by lint-early-a (please review):** `src/rustc_lint/levels.oracle.test.ts`. Its EARLY cases used to stop
  at the first stub pass method (exit 70). They now run through all the passes and stop cleanly, so `check()` compares
  our stderr minus its final summary as a prefix of rustc's (`stops_after_early_lints`). Exact equality cannot hold,
  because rustc goes on to later phases.

## Coverage (`bun scripts/coverage.ts --missing`)
| upstream file | ported | missing early | missing late (M3) |
|---|---|---|---|
| builtin.rs | 26/78 | 0 | 52 |
| unused.rs | 36/40 | 0 | 4 (PathStatements, UnusedAllocation, ...) |
| nonstandard_style.rs | 10/30 | 0 | 20 (NonSnakeCase incl. `to_snake_case`, NonUpperCaseGlobals) |
| non_ascii_idents.rs | 1/1 | 0 | 0 |
| precedence.rs | 1/1 | 0 | 0 |
| redundant_semicolon.rs | 2/2 | 0 | 0 |
| macro_expr_fragment_specifier_2024_migration.rs | 3/3 | 0 | 0 |
| internal.rs | 6/28 | 0 | 22 |
| unicode-script-0.5.7 | 52/52 | | |
| unicode-security-0.1.2 | 40/40 | | |

`bun scripts/coverage.ts --check` reports `markers ok (7015; vendor 2695)`, but **only with the two scope.json entries
below**. I tested that with a temporary copy and did not commit it. Without the entries it reports the new `// crate:`
markers as "names no harness/scope.json vendor crate" and nothing else. This is the same situation as earlier vendor lanes.
- **harness/scope.json `vendor`:** add `"unicode-script": "=0.5.7"` and `"unicode-security": "=0.1.2"`.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 3418 pass, 1 skip, 0 fail.
- `--suite parse --sample 200`: 200/200 MATCH (run 20261013-134832-lint-early-b-qo9q).
  `--suite parse-ui --sample 200`: 200/200 MATCH (run 20261013-134839-lint-early-b-g4bm).
- `--suite expanded-nocore --sample 100`: 1 MATCH, 99 UNPORTED, none in rustc_lint (37 `CStore::from_tcx`, 31
  `query_feed` re-feeding `visibility`, 11 `CStore::from_tcx_mut`, plus resolve diagnostics).
- **Oracle scenarios** (`early_passes.oracle.test.ts`, 19/19). Each one compiles a `#![no_core]` lib with rustc and runs
  `earlylints.ts`. Our stderr minus its summary must be a prefix of rustc's and contain the diagnostics under test.
  Coverage:
  - `while_true`, including labels and parens.
  - `double_negations`.
  - `redundant_semicolons`, single and multiple.
  - `unsafe_code`: trait, impl, extern block, fn, assoc decl/impl, block.
  - `anonymous_parameters` in 2015, with the snippet suggestion.
  - `unused_doc_comments`: let, arms, line and block help, expressions, pattern and expression fields, generic params,
    extern blocks.
  - `ellipsis_inclusive_range_patterns`: 2018 lint and 2021 E0783, `&0...9` parenthesised and `...=` forms.
  - `incomplete_features` with issue note and min_specialization help, and `internal_features`.
  - `special_module_name`, with `#[path]` exempt.
  - `edition_2024_expr_fragment_specifier`.
  - `non_ascii_idents`, `uncommon_codepoints`, `confusable_idents` and `mixed_script_confusables`.
  - `non_camel_case_types`: all kinds, `repr(C)` exempt, Σ/DŽ/CJK/`__`/leading `_`.
  - `ambiguous_negative_literals`.
  - `unused_parens`: every ctx, patterns, types, dyn/impl bounds and no-bounds positions, the `dyn (::A)` 2015
    exception, `as (T) <`.
  - `unused_braces` in 2021 and 2024, including the temporaries rule.
  - `unused_import_braces`.
  - Internal `lint_pass_impl_without_macro` and `implicit_sysroot_crate_import` with `-Zunstable-options`.
- **tests/ui sample** (`$RUST_TS_DATA/tmp/lint-early-b/scripts/uisample.ts`, same prefix check, host target, files
  without aux/revisions):

  | tests/ui dir | files | prefix-ok | bad |
  |---|---|---|---|
  | lint | 705 | 647 | 8 |
  | parser | 924 | 893 | 11 |
  | macros | 476 | 405 | 4 |
  | editions, rust-2018/2021/2024, unsafe, range | | | 0 |
  | lint/rfc-2457-non-ascii-idents | 5 | 5 | 0 |

  Every bad case is a test-driver artifact, not a pass divergence:
  - no macro expansion: `unit!{}` operands, `/// doc` on `mac!()`, `#[cfg(false)]` items, `cfg_attr`;
  - no AST validation, feature gating or resolve errors, which rustc prints before the early lints;
  - no session warnings (`multiple output types`);
  - JSON summaries.
- `$RUST_TS_DATA/tmp/lint-early-b/title.rs` checks the `to_titlecase` stand-in against the oracle's
  `char::to_titlecase` for every char: 0 mismatches.

## unported(...) left
- None in the early passes.
- Late placeholders (M3) are unchanged, plus 2 added ones (see PORT 9).
- `InternalCombinedEarlyLintPass` is reachable (`register_internals` with `-Zunstable-options`) and ported.
  BadUseOfFindAttr only fires on arms expanded from a `find_attr!` macro, so it cannot be tested before expansion works.

## PORT decisions (root: please record)
1. **`char::to_titlecase` stand-in** in `nonstandard_style.ts`. src/std has no titlecase, and lanes may not edit src/std.
   The stand-in is `conversions::to_title`: the `TITLECASE_LUT` exceptions (26 singles, 23 multis, 1 plane-1 exception)
   transcribed from library/core/src/unicode/unicode_data.rs at the pin, falling back to `to_uppercase`. Verified against
   the oracle for all chars. **Root: move it to src/std/char.ts with a table generated by tools/gen-unicode.ts / lexdump
   `--unicode`.**
2. **`UnusedDelimLint`.** The associated consts are read-only members: getters on UnusedParens, `defineProperty` on the
   generated UnusedBraces. The provided methods live in `UnusedDelimLint_provided` (implementor passed as `self`). The
   passes' `EarlyLintPass` methods of the same name call them explicitly, as upstream's
   `<Self as UnusedDelimLint>::check_expr` does. The required methods carry markers on the interface.
3. `impl From<UnusedDelimsCtx> for &str` is `str_from_UnusedDelimsCtx`. `&[closure.body.clone()]` checks the body
   itself, since it is only read.
4. `warn_if_doc`: `iter().peekable()` becomes an index. `extract_if`, `trim_matches('_')`, `chars()` and `Iterator::eq`
   are small local helpers.
5. **NonAsciiIdents.**
   - `FxIndexMap<AugmentedScriptSet, _>` is an insertion-ordered `Map` keyed by `AugmentedScriptSet.hash_key()` (same
     equality).
   - `BTreeMap<(OrdSpan, Vec<char>), _>` is a key-unique array sorted by `OrdSpan::cmp`, then `Vec<char>` order.
   - The stable sort of the symbol gallery starts from its insertion order instead of `FxHashMap` order. This only
     matters for equal `lo_hi`.
6. **Vendor representations.**
   - unicode-script: `ScriptExtension` is immutable with `bigint` bitsets, and `intersect_with` returns the new value.
     `Script` is a string union with `Script_discriminant`.
   - `script_extensions::X` becomes `script_extensions().X`, built lazily because lib.ts and tables.ts import each other.
   - unicode-security: `AugmentedScriptSet` is a mutable class with `clone()`; callers copy where Rust copies.
   - The traits are `*_char` / `*_str` impl objects (as unicode-normalization).
   - `skeleton` returns a `CharIterator` (nfd ∘ flat_map(char_prototype) ∘ nfd) through the vendored
     unicode-normalization.
   - The upstream Display bug in unicode-script (" + " is never written) is kept.
7. **BadUseOfFindAttr** keeps upstream's `PatKind::Ref(..) => find_attr_kind_in_pat(cx, pat)`, which recurses on the
   same pattern.
8. `soft::lint_vec` is `export const soft = { lint_vec }`.
9. **internal.ts**: added the missing `unported_methods` placeholders for `DefaultHashTypes::check_path` and
   `BadOptAccess::check_expr`. lint-early-a's stub generator skipped `impl LateLintPass<'_> for ..`. Root may want to
   re-run that check on other modules (`grep "^impl LateLintPass<'_>"` finds only these two in rustc_lint).
10. Test driver `src/rust_ts/earlylints.ts` (not a port), described above.

## For root
- After merging, add the scope.json vendor entries and move the two scratch scripts if wanted:
  - `gen-unicode-security.ts` to tools/;
  - `uisample.ts`, the tests/ui prefix sampler.
- When wave 11 (creader) lands, `early_lint_checks` becomes reachable from the real driver. Expect expanded-nocore cases
  to show early-lint diagnostics then. The passes have been checked only on unexpanded crates, so macro-expanded code
  (`from_expansion` paths, `allow_internal_unsafe`, `find_attr!` arms, Expr2024 on real `macro_rules!`) is first
  exercised there.
