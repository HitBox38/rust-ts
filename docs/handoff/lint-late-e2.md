# Handoff: lint-late-e2 (wave 21, M4-0: late lints, part e2 of 6)

Branch `lane/lint-late-e2`, based on 970d2365. No merges.

## Result
All 13 assigned files are fully ported (every fn, upstream order, markers): the late passes MapUnitFn,
MultipleSupertraitUpcastable, NoopMethodCall, OpaqueHiddenInferredBound, PtrNullChecks, RawBorrowsViaReferences,
RuntimeSymbols, ShadowedIntoIter, StaticMutRefs, DropTraitConstraints (traits.rs), UnitBindings,
UnqualifiedLocalImports, and utils.rs (`peel_casts`, `std_or_core`). passes.rs (71/71) and lib.rs (6/6) had no unported
late parts left: every pass is already listed in lib.ts's `BuiltinCombinedLateLintModPass`, so **nothing needs
registering**. All constructors there (`new X()`) are right for these passes.

The pattern is lint-late-a's (docs/handoff/lint-late-a.md, committed as 22ff2d95 while this lane ran): the pass type
from `<file>.lints.gen.ts` gets `declare module ... interface X extends LateLintPass {}`, and each `check_*` is a
prototype assignment with its marker. `ShadowedIntoIter` (an `impl_lint_pass!` struct) stays a class in
shadowed_into_iter.ts. The `unported_methods` placeholders are gone from all 12 pass files.

## Files
- Ported: `src/rustc_lint/{map_unit_fn,multiple_supertrait_upcastable,noop_method_call,opaque_hidden_inferred_bound,
  ptr_nulls,raw_borrows_via_references,runtime_symbols,shadowed_into_iter,static_mut_refs,traits,unit_bindings,
  unqualified_local_imports,utils}.ts`.
- Test (new): `src/rustc_lint/late_e2.oracle.test.ts`, 16 oracle cases, at least one per lint: 12 compare stderr and
  the exit code byte for byte; 4 are pinned to the `unported` stop they reach (see below), and the oracle output is
  still checked for the diagnostic.
- Test driver (new, not a port): `src/rustc_lint/late_e2_oracle/{run.ts,walker.ts}`. This is a stand-in written before
  lint-late-a landed: a minimal copy of `LateContextAndPass` and of the `LateContext` methods the passes use. The test
  uses lint-late-a's `src/rustc_lint/late_oracle/run.ts --late-pass=<file>:<Pass>` when that file exists. **Root: after
  merging lint-late-a, delete `src/rustc_lint/late_e2_oracle/`** (and the fallback branch in the test's `subject()`).

## Integration with lint-late-a (verified)
I trial-merged `lane/lint-late-a` (22ff2d95) onto this branch in a scratch worktree. The merge had no conflicts,
`bunx tsc --noEmit -p .` was clean, and all 16 cases passed through lint-late-a's real `late_lint_mod` driver. The
casts this lane adds where context.ts at the base types `LateContext` members `unknown` (`cx.typeck_results_() as
TypeckResults`, `cx.typing_env() as TypingEnv`, `cx.qpath_res(..) as Res`, `cx.expr_or_init(e) as Expr`,
`cx.param_env as ParamEnv`, each with a `// PORT:` note) become no-ops after the merge. They can be dropped in a
cleanup.

## Coverage (`bun scripts/coverage.ts --missing compiler/rustc_lint/src/<file>`)
map_unit_fn 2/2, multiple_supertrait_upcastable 1/1, noop_method_call 1/1, opaque_hidden_inferred_bound 1/1,
ptr_nulls 3/3, raw_borrows_via_references 1/1, runtime_symbols 4/4, shadowed_into_iter 3/3, static_mut_refs 9/9,
traits 2/2, unit_bindings 1/1, unqualified_local_imports 1/1, utils 2/2. passes 71/71, lib 6/6.
`coverage --check`: markers ok.

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: ok.
- `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000`: 5412 pass, 1 skip, 0 fail (363 files), on f8bf0da6. The
  final commit changes only test glue (walker typing, the test's driver choice) and a `ptr_nulls.ts` helper's
  parameter type; `late_e2.oracle.test.ts` was rerun after it: 16/16 pass.
- tydump-minicore (46): base 970d2365 and lane have MATCH 45 / UNPORTED 1, identical per case (runs
  `e2-base-tydump-minicore`, `e2-lane-tydump-minicore`).
- `hir-tree --sample 300` (seed lint-late-e2): base and lane have MATCH 299 / UNPORTED 1, identical per case
  (`e2-base-hir-tree`, `e2-lane-hir-tree`).

## `unported(...)` left, and pinned stops
1. **runtime_symbols.rs `check_item`: `rustc_symbol_mangling::symbol_name_from_attrs`** (rustc_symbol_mangling/src/lib.rs:172;
   the crate is not ported). Called for every non-generic `fn` item and every `static`. **Once the real
   `rustc_lint::check_crate` runs the combined pass, almost every crate stops here as UNPORTED.** It is the first
   thing to port before turning the late lints on: `symbol_name_from_attrs` needs `codegen_instance_attrs` (ported),
   `proc_macro_decls_static`, `generate_proc_macro_decls_symbol` and `v0::mangle_internal_symbol` (only for
   `#[rustc_std_internal_symbol]`). The foreign-item path also stops: the `symbol_name` query (no provider, and no
   `QueryKey` for `Instance`: "rustc_middle::query::keys: QueryKey for `ty::Instance<'tcx>` (cache)") and the
   `all_canonical_symbols` query (no provider). Pinned test cases: `runtime_symbols: #[no_mangle] fn` and
   `runtime_symbols: foreign fn`.
2. **opaque_hidden_inferred_bound.rs**: the file's own `#[derive(Diagnostic)] OpaqueHiddenInferredBoundLint` and
   `#[derive(Subdiagnostic)] AddBound` are not generated: tools/codegen/types.sets.json's `rustc_lint` set lists only
   diagnostics.rs. The pass runs fully and stops with `unported("rustc_lint::opaque_hidden_inferred_bound::
   OpaqueHiddenInferredBoundLint ...")` only where it would emit. **Root/tools: add
   `compiler/rustc_lint/src/opaque_hidden_inferred_bound.rs` to that set**, then replace the `unported` with
   `cx.emit_span_lint(OPAQUE_HIDDEN_INFERRED_BOUND, pred_span, OpaqueHiddenInferredBoundLint_diagnostic(lint))`.
   Other late lint files with their own derive structs probably need the same. The emitting path cannot be tested
   yet in any case: every opaque with a hidden type reaches `mir_borrowck provider (not ported)` in the typeck prefix
   before the lints run, as pinned by the TAIT case (tests/ui/impl-trait/nested-return-type3-tait3.rs). The RPITIT
   skip path is tested and matches.
3. **traits.rs `drop_bounds`**: the pass is complete, but `DropTraitConstraintsDiag_into_diag` in diagnostics.ts (not
   this lane's file) is still `unported("... (IntoDiagArg for ty::Clause, M3)")`, although `Clause_into_diag_arg` now
   exists in rustc_middle/ty/predicate.ts. **Owner of diagnostics.ts:** port it as
   `Diag::new(..).with_arg("clause", clause).with_arg("needs_drop", tcx.def_path_str(def_id))` per
   diagnostics.rs:2054. Pinned test case: `drop_bounds`. `dyn_drop` is tested and matches.

## `// PORT:` decisions
- Casts at uses of the `unknown`-typed `LateContext` members of the base context.ts (see above).
- multiple_supertrait_upcastable: the lazy `filter_map/filter/count` chain is a loop counting in the same order.
- shadowed_into_iter: `take_while(..).position(..)` is a local `position_before`; `hir_parent_iter(..).nth(1)` is a
  counted loop.
- runtime_symbols: the missing `symbol_name_from_attrs` is an inline `unported(..)` at its two call sites (no stand-in
  function in another crate's path).
- opaque_hidden_inferred_bound: `fold_ClauseKind` is a local D4 descriptor built from the generated
  `visit_with_ClauseKind` / `try_fold_with_ClauseKind` / `fold_with_ClauseKind` (as ty/print/pretty.ts does).
- static_mut_refs: `find_word` / `extend_trailing_space` work on the UTF-8 `Str` from `span_to_snippet` (byte indices,
  `Str.slice` panics off char boundaries as `&snippet[a..]` does).
- Test driver walker (`late_e2_oracle/walker.ts`): its `LateContext` overrides have no return annotations, so it
  compiles against both the base and lint-late-a's typed context.ts.
