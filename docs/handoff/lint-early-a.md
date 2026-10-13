# Handoff: lint-early-a (wave 10, M2: rustc_lint core)

Branch `lane/lint-early-a`, based on bb96986. No merges.

## Result
The lint store, lint levels and the early lint driver are real. `run_compiler` builds the `LintStore`
(`new_lint_store`); `configure_and_expand`'s pre-expansion lint pass and `early_lint_checks` run
`rustc_lint::check_ast_node`. The pre-expansion pass (`KeywordIdents`, ported ahead of lint-early-b, see decision 1)
runs on every crate, so nocore cases now get past the lints and stop at the next pending lane.

**expanded-nocore `--sample 300`** (run 20261013-125722-lint-early-a-ksfj): 296 `rustc_resolve::macros::Resolver::register_builtin_macro`
(res-macros is not on this branch's base), 4 MATCH. Before: every case stopped at `rustc_lint::late::unerased_lint_store`.
Prefix check of the 296 UNPORTED cases (driver-m2's `tmp/driver-m2/scripts/prefix.ts`): **296/296 ok**.

## Files
- **New, hand ports:**
  - `src/rustc_lint/lib.ts`: lib.rs 6/6 (`provide`, `lint_mod`, the 5 combined passes, `new_lint_store`, `register_builtins`
    (groups, renamed/removed/ignored lints transcribed from upstream by script), `register_internals`, `is_lint_pass_required`).
  - `context.ts` 58/58, `levels.ts` 54/54, `early.ts` 36/36, `early/diagnostics.ts` 1/1, `passes.ts` 71/71,
    `diagnostics.ts` 19/19 (the hand `Diagnostic`/`Subdiagnostic` impls), `late.ts` (`unerased_lint_store` only; 1/38),
    `expect.ts` (`provide`), `foreign_modules.ts` (`provide`, `lint_vec`).
  - `src/rustc_middle/lint.ts` 17/17 (`LintLevelSource`, `LevelSpec`, `ShallowLintLevelMap`, `reveal_actual_level_spec`,
    `LintExpectation`, `explain_lint_level_source`, `emit_lint_base`/`emit_lint_base_impl`, `TyCtxt::lint_level_spec_at_node`).
  - `builtin.ts`: `KeywordIdents` (5 fns, builtin.rs:1748-1828) and the `EllipsisInclusiveRangePatterns` struct + derived `Default`;
    `unused.ts`: the `UnusedParens` struct + derived `Default`.
- **New, generated:** `src/rustc_lint/diagnostics.gen.ts` (new codegen set `rustc_lint`: 209 types, 191 derives);
  `src/rustc_lint/**/*.lints.gen.ts` (48 modules: 122 `declare_lint!`/`declare_tool_lint!` statics, 89 `declare_lint_pass!`/
  `impl_lint_pass!` expansions).
- **New stubs** (parser-core pattern, no markers): every other rustc_lint module (`builtin.ts`, `unused.ts`, `unused/must_use.ts`,
  `nonstandard_style.ts`, `non_ascii_idents.ts`, `internal.ts`, `types.ts`, `types/*.ts`, `utils.ts`, ... 50 files). Each re-exports its
  `.lints.gen.ts`, defines the `impl_lint_pass!` struct types (`name`/`get_lints`/`static lint_vec` + `default()`/`new()` stubs), and installs
  `unported_methods` for exactly the `check_*` methods upstream's `impl EarlyLintPass`/`impl LateLintPass` define, so no pass silently no-ops.
  Generated once by `$RUST_TS_DATA/tmp/lint-early-a/scripts/{passes,stubs}.py`.
- **Tests:** `src/rustc_lint/levels.oracle.test.ts` (11 oracle cases), test driver `src/rust_ts/lintlevels.ts`.
- **Changed outside rustc_lint (please review):**
  - `src/rustc_interface/passes.ts`: lint shims deleted; `rustc_lint.{unerased_lint_store, check_ast_node, provide}` wired (call sites only).
  - `src/rustc_interface/interface.ts`: `sess.lint_store = rustc_lint.new_lint_store(sess.enable_internal_lints())` instead of `defer_field`.
  - `tools/codegen/lints.ts`: rustc_lint module mode (`generateModule`/`generateRustcLint`: `declare_tool_lint!` (fingerprinted),
    `impl_lint_pass!`, optional `$vis`, cross-crate pass lint lists checked against lint_defs builtin); fixed a bug where an ident
    `constructor` counted as an opening delimiter (`t.text in pairs`). builtin.gen.ts regenerates byte-identically; `--check` covers all.
  - `tools/codegen/diagnostics.ts`: `format!` `{x:X}` (UpperHex of unsigned ints) in suggestion code (`OnlyCastu8ToChar`).
  - `tools/codegen/types.ts`: diag_args entries may carry `arg0` (impl for one instantiation, `Vec<char>`); `daIndex` holds lists.
  - `tools/codegen/diag_args.json` (`Vec<char>`, lint_defs `Level` via rustc_errors' `LintLevel`), new `tools/codegen/typemap.lint.json`,
    `tools/codegen/types.sets.json` (set `rustc_lint`).

## Coverage
`--missing`: lib.rs 6/6, early.rs 36/36, context.rs 58/58, levels.rs 54/54, passes.rs 71/71, diagnostics.rs 19/19,
early/diagnostics.rs 1/1, rustc_middle lint.rs 17/17. late.rs 1/38 (only `unerased_lint_store` was in scope).
`bun scripts/coverage.ts --check`: markers ok (6410; vendor 2403).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 3030 pass, 1 skip, **14 fail, all pre-existing on this base**:
  driver.oracle.test.ts (2) and output.oracle.test.ts (12) PENDING texts still say `Resolver::arenas (pending res-lib)` here; main
  has since changed them to `rustc_lint::late::unerased_lint_store (pending lint-early-a)`. **Root: after merging, set them to the
  new stop point** (on this branch it is `rustc_resolve::macros::Resolver::register_builtin_macro`; on main it will be further on).
- `--suite parse --sample 300`: 300/300 MATCH (run 20261013-125701-lint-early-a-nftl); `--suite parse-ui --sample 300`: 300/300 MATCH
  (run 20261013-125709-lint-early-a-wcv7).
- **Oracle scenarios** (`levels.oracle.test.ts`, 11/11; each: our stderr up to `rust-ts: unported` is a prefix of rustc's and contains the
  diagnostics under test): unknown lints with suggestions (`did you mean: unused_variables / rust_2018_idioms`), upper-case names,
  renamed/removed lints (attribute and `-A/-W/-D`), unknown tool (E0710), `clippy::`/`rustdoc::` missing tools, malformed attributes and
  `reason` (E0452), forbid then allow (E0453; group → `forbidden_lint_groups` FCW with notes), `-F` then `#![allow]`, `--force-warn warnings`
  (E0602), `--cap-lints=warn`, `#![deny(warnings)]` (`implied by #[deny(warnings)]`), feature-gated lint (`must_not_suspend` is unstable),
  deprecated group names; through the real driver: `keyword_idents` (`#![warn]`, `-D keyword-idents-2024`, `-A warnings`) with the
  "lint level is defined here" / "requested on the command line" notes. The early cases stop at the first stub pass method
  (`IncompleteInternalFeatures::check_crate`), after all crate-level lint level diagnostics.
- Not testable yet: unfulfilled `#[expect]` (`check_expectations`, M3); lint attributes on inner items (need the early pass stubs).

## unported(...) left (reachable)
- Every individual lint pass `check_*` method (stubs; lint-early-b fills the early ones, the late ones are M3); `IfLetRescope`,
  `ImproperCTypesLint`, `NonLocalDefinitions::default`, `TypeLimits::new` (late).
- HIR side (M3): `shallow_lint_levels_on`, `skippable_lints` (`hir_crate_items`), `LintLevelQueryMap` visitor/`add_id`,
  `ShallowLintLevelMap::probe_for_lint_level_spec` (`hir_parent_id_iter`), `LateContext` methods (`typing_mode`, `qpath_res`, ...,
  `opt_span_lint` → `emit_node_span_lint`), `LintPathPrinter`, `expect::{lint_expectations, check_expectations}`,
  `foreign_modules::clashing_extern_declarations`, `late::{late_lint_mod, check_crate}`, `utils::*`.
- Hand diagnostics needing `ty`: `BuiltinTypeAliasBounds`, `BuiltinUnpermittedTypeInit(+Sub)`, `BuiltinClashingExternSub`,
  `DropTraitConstraintsDiag`, `ImproperCTypes`, `MismatchedLifetimeSyntaxes`; generated derives with `Ty` args use `unported_into_diag_arg`.

## PORT decisions (root: please record)
1. **KeywordIdents ported in this lane** (builtin.ts): it is the only member of `BuiltinCombinedPreExpansionLintPass` (lib.rs), which runs
   on every crate before expansion; leaving it a stub would have stopped every case there. lint-early-b skips it.
2. `early_lint_methods!`/`late_lint_methods!` → name lists; `declare_combined_{early,late}_lint_pass!` → functions building the class from
   `[type, constructor]` entries; trait defaults → `EarlyLintPass_provided`/`LateLintPass_provided` (optional interface methods; the
   helper calls the pass's method if it has one). `RuntimeCombinedEarlyLintPass` installs its methods in a loop.
3. `LevelSpec` is an immutable class (fields `level`/`lint_id`, getters `level_()`/`lint_id_()` as MultiSpan's); writes to the `Copy`
   local in `reveal_actual_level_spec` build a new spec (`with_level`). `impl Into<LevelSpec>` → callers pass the converted spec;
   the `LintLevelsProvider` gets `into_level_spec`, `LintContext` gets `into_lint_expectation_id` (the associated-type bounds).
4. `ShallowLintLevelMap.specs`: `SortedMap` → `Map` (only get/insert/values are used). `LintStore.by_name`: `UnordMap` → `Map` (only
   `keys().any`). `skippable_lints`/`shallow_lint_levels_on` return types stay `unknown` in queries.gen.ts (cast at the use site).
5. `LintLevelsBuilder<P>` is one class; methods of the `TopDown`/`LintLevelQueryMap` impl blocks are typed on `this`. `add` takes the
   `AttributeExt` impl table. `BuilderPush`'s `cfg(debug_assertions)` `Drop` is a never-called `drop()` (`pop` forgets).
6. `impl_lint_pass!($ty => [..])` on a hand struct → generated `<Ty>_impl_lint_pass` object; the stub/hand struct forwards `name`,
   `get_lints`, `static lint_vec` to it. `declare_lint_pass!` → generated class (as builtin.gen.ts). Lint lists referring to
   `rustc_lint_defs::builtin` statics import them from there (the generator checks they exist).
7. Generated `diagnostics.gen.ts` maps `rustc_lint_defs::Level` to rustc_errors' re-export `LintLevel` (it imports rustc_errors' `Level`
   too); `ty::Ty`, `Clause`, `PolyFnSig`, `PolyExistentialTraitRef`, `hir::Ty`, `hir::WherePredicate`, `InitError`,
   `LifetimeSyntaxCategories` are `unknown` (typemap.lint.json, M3).
8. `UnusedDocComment` is `rustc_lint_defs::builtin`'s generated class; rustc_lint's `impl EarlyLintPass for UnusedDocComment` stub
   installs its placeholders on that prototype.
9. `levels.rs` uses rustc_hir_id's real `HirId`/`OwnerId`/`CRATE_HIR_ID`; rustc_lint_defs' `HirId` stand-in (for
   `StableLintExpectationId`) is structurally compatible. Root: repoint typemap.lint_defs.json to rustc_hir_id now that it exists.
10. Debug derives of private types only reachable from `debug!`/`instrument!` (`LintLevelSets`, `LintSet`) are not written.
11. `src/rust_ts/lintlevels.ts` is a test driver (not a port) that runs the two `check_ast_node` calls from `after_crate_root_parsing`.

## For other lanes / root
- **lint-early-b**: fill the stubs' early `check_*` methods (remove names from each `unported_methods` list as you assign them); the
  pass structs with fields (`UnusedParens`, `EllipsisInclusiveRangePatterns`) already have their fields and `default()`.
  `NoBoundsException` (unused.rs) is `unknown` in `UnusedParens.in_no_bounds_pos`.
- **Root**: update the PENDING stop texts in driver.oracle.test.ts / output.oracle.test.ts after merging (see Checks).
  `rustc_lint/lib.ts` imports `../rustc_middle/lint.ts` for its `TyCtxt.lint_level_spec_at_node` extension; consider
  `export * as lint` in rustc_middle/lib.ts.
