# Handoff: lint-late-a (wave 21, M4-0: late lint driver + builtin.rs late passes)

Branch `lane/lint-late-a`, based on 970d2365. No merges. The registration/contract section below was committed first (22ff2d95).

## Registration pattern for late lint passes (lanes lint-late-b..e2: read this first)

Nothing needs registering in lib.ts: every upstream late pass is already listed, in upstream order, in lib.ts's
`BuiltinCombinedLateLintModPass` / `InternalCombinedLateLintModPass` (`declare_combined_late_lint_pass` of passes.ts,
`p<L>(PassType, () => constructor)` entries). Do not edit lib.ts; if a constructor there is wrong for your pass (e.g.
the pass gets fields and upstream uses `Pass::new()` / `Pass::default()`), write it in your handoff for root.

In your file (as the early passes did, e.g. builtin.ts `WhileTrue`):
1. The pass type comes from `<file>.lints.gen.ts` (generated `declare_lint_pass!` / `impl_lint_pass!` expansion) or is a
   class in your file (`impl_lint_pass!` structs with fields). Give it the trait's method signatures:
   ```ts
   declare module "./foo.lints.gen.ts" {
     interface Foo extends LateLintPass {}
   }
   ```
2. Port each `impl LateLintPass for Foo` method as a prototype assignment with the marker on the line above:
   ```ts
   // rustc: compiler/rustc_lint/src/foo.rs:123 check_expr
   Foo.prototype.check_expr = function (this: Foo, cx: LateContext, e: hir.Expr): void { ... };
   ```
   `passes.ts`'s `LateLintPass` types the parameters as `unknown`; method parameters are bivariant, so declare the real
   HIR types (`hir.Expr`, `hir.Item`, ...; `import type * as hir from "../rustc_hir/hir.ts"`).
3. Delete the method's name from the file's `unported_methods(Foo.prototype, ..., [...])` placeholder list (delete the
   call when the list is empty). A method left in the list is an `unported` stub, so a combined pass that reaches it
   stops as UNPORTED (exit 70) instead of silently doing nothing.
4. Emit with `cx.emit_span_lint(LINT, span, Xxx_diagnostic({...}))` (diagnostics.gen.ts / diagnostics.ts) or
   `cx.opt_span_lint(..)`; `cx.tcx.emit_node_span_lint(..)` for lints at another node.

`LateContext` (context.ts) is ported (this lane): fields keep upstream names and are typed (`enclosing_body:
hir.BodyId | undefined`, `typeck_results: TypeckResults | undefined`, `param_env: ParamEnv`, `effective_visibilities:
EffectiveVisibilities`, `last_node_with_lint_attrs: HirId`, `generics: hir.Generics | undefined`, `only_module`).
Methods: `typeck_results_()` (the upstream `typeck_results()` method; ICEs outside bodies), `typing_mode()`,
`typing_env()`, `type_is_copy_modulo_regions(ty)`, `type_is_use_cloned_modulo_regions(ty)`, `qpath_res(qpath, id)`,
`get_def_path(def_id)`, `get_associated_type(self_ty, trait_id, name)`, `precedence(expr)`, `expr_or_init(expr)`,
`expr_or_init_with_outside_body(expr)`, `data_layout()`, `tcx_()` (`HasTyCtxt`), `typing_env_()` (`HasTypingEnv`),
`handle_layout_err`, and the `LayoutOf` glue: `cx.layout_of(ty)` / `cx.spanned_layout_of(ty, span)` (`Result<TyAndLayout,
LayoutError>`), `cx.LayoutOfResult`, `layout_tcx_at_span()`, as rustc_middle's `LayoutCx`.

late.ts is fully ported (`LateContextAndPass` visitor with `nested_filter::All`, `RuntimeCombinedLateLintPass`,
`late_lint_mod`, `late_lint_crate`, `check_crate`). `lint_mod` (lib.ts) runs `BuiltinCombinedLateLintModPass` per module.

### Testing late passes against the oracle
`analysis` (rustc_interface passes.rs) is not ported, so the real driver does not reach the late lints. Test driver:
`src/rustc_lint/late_oracle/run.ts` (see its header): `run_required_analyses_prefix` (tydump's, includes typeck of all
bodies), abort on non-lint errors, the late lints, `check_expectations`, stop.
- `bun src/rustc_lint/late_oracle/run.ts --late-pass=foo.ts:Foo [--late-pass=..] <rustc args>` runs only the listed
  passes (a combined pass in the given order) on every module with `late_lint_mod`.
- Without `--late-pass` it runs the real `rustc_lint::check_crate` (needs every pass in the combined pass ported).
Write your own `src/rustc_lint/<yourfile>.oracle.test.ts` (copy the harness part of
`src/rustc_lint/late_builtin.oracle.test.ts`): compile each case with the pinned rustc as a lib (`--crate-type=lib
--emit=metadata`, std) and with the driver, compare stderr and the exit code byte for byte. Cases must not trigger
diagnostics the driver does not run (borrowck, liveness `unused_*`, `dead_code`, other late lints): use `pub` items
and `#![allow(..)]` where needed.

## Result
- late.rs: 38/38 (all of it; `unerased_lint_store` was already ported).
- builtin.rs: 78/78 (every late pass: NonShorthandFieldPatterns, MissingDoc (+`has_doc`), MissingCopyImplementations
  (+`type_implements_negative_copy_modulo_regions`), MissingDebugImplementations, InvalidNoMangleItems, MutableTransmutes,
  UnstableFeatures, UngatedAsyncFnTrackCaller, UnreachablePub, TypeAliasBounds (+`affects_object_lifetime_defaults`,
  `ShorthandAssocTyCollector`), TrivialConstraints, ExplicitOutlivesRequirements (+4 helpers), InvalidValue (`InitError`,
  `is_zero`, `is_dangerous_init`, `variant_find_init_error`, `ty_find_init_error`), DerefNullPtr, AsmLabels (+3 hexagon
  helpers), InternalEqTraitMethodImpls). No `unported_methods` placeholders left in builtin.ts.
- context.rs 58/58: `LateContext` was mostly `unported` bodies; now real (see the contract section) + `LayoutOf` glue.

## Files
- `src/rustc_lint/late.ts` (rewritten), `src/rustc_lint/builtin.ts` (late passes inserted in upstream order between the
  early sections), `src/rustc_lint/context.ts` (outside the strict list: `LateContext` / `LintPathPrinter`, recorded
  decision), `src/rustc_lint/diagnostics.ts` (outside the strict list: the three hand-written impls of builtin lints,
  `BuiltinTypeAliasBounds::into_diag` rest, `BuiltinUnpermittedTypeInit::into_diag`, `BuiltinUnpermittedTypeInitSub::add_to_diag`).
- New: `src/rustc_lint/late_oracle/run.ts` (test driver, not a port), `src/rustc_lint/late_builtin.oracle.test.ts` (17 cases).
- lib.ts unchanged (the combined passes were already declared there).

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok (17373; vendor 3888).
- `late_builtin.oracle.test.ts`: 17/17 byte-identical stderr + exit code vs rustc (`--target x86_64-unknown-linux-gnu
  --crate-type=lib --emit=metadata`, std): one case per pass plus a lint-level case (`#[allow]`/`#[expect]`/`#[deny]` on
  items, fields, modules, `let` statements through `with_lint_attrs`, unfulfilled expectation).
- `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000`: 5412 pass, 1 skip, 1 fail; the one failure was
  std/result.test.ts (one-argument `unwrap_result` in context.ts `get_def_path`). It is fixed with `debug_PrintError`,
  and result.test.ts now passes (3/3).
- tydump-minicore: 45/46 (1 UNPORTED, as before; run 20261021-180358-lint-late-a-npoc).
- tydump-ui --sample 300: 261 MATCH / 37 UNPORTED / 2 UNSTABLE, case-for-case identical to base 970d2365 on the same
  sample (runs 20261021-180432-lint-late-a-eot6 vs 20261021-181044-lint-late-a-y11s).
- hir-tree --sample 300: 300/300 (run 20261021-180751-lint-late-a-on0h).
- Note: the upstream checkout has 2 strays (`libmini_core.rlib`, `mini_core.mir`) not created by this lane; difftest warns.

## Firing paths not reachable yet (tests cover the non-firing paths)
- InvalidValue: the diagnostic calls `Ty::inhabited_predicate` (rustc_middle inhabitedness, stub) and the enum branch needs
  `VariantDef::inhabited_predicate` → `unported`. Every firing case is UNPORTED until inhabitedness lands (wave 22).
- TrivialConstraints: `BuiltinTrivialBounds`'s generated into_diag uses `unported_into_diag_arg` for `clause: Clause`.
  **Root/codegen:** map `Clause` to `Clause_into_diag_arg` (rustc_middle ty/predicate.ts) in tools/codegen for rustc_lint
  (3 other `unported_into_diag_arg` uses in diagnostics.gen.ts are other lanes' lints).
- UngatedAsyncFnTrackCaller: async fn bodies need `mir_borrowck` (M4).
- MissingCopyImplementations on types whose `layout_of` needs const eval (e.g. a `String` field) → UNPORTED (M4).

## unported(...) left
- builtin.ts `ty_find_init_error`: `rustc_middle::ty::inhabitedness VariantDef::inhabited_predicate (not ported)`.

## PORT decisions
1. `LateContext::typeck_results()` is `typeck_results_()`; `HasTyCtxt::tcx` / `HasTypingEnv::typing_env` are `tcx_()` /
   `typing_env_()`; `LintPathPrinter extends Printer` with field `tcx_` (recorded decision).
2. late.ts: `lint_callback!` → `LateLintPass_provided.check_x(cx.pass, cx.context, ..)`; `RuntimeCombinedLateLintPass`
   methods installed from `LATE_LINT_METHODS`; `Option::replace/take` spelled out; `typeck_body` gets the `hir::BodyId`
   cast to rustc_middle's pending `BodyId` (as rustc_privacy).
3. builtin.ts: `InitError::nested` (method) is `nested_` (field keeps `nested`); `From<&str>`/`From<String>` are
   `InitError.from_str` / `from_String`; `InitKind`/`AsmLabelKind` are string unions; the static fns of generated pass
   classes (`TypeAliasBounds.affects_object_lifetime_defaults`, `ExplicitOutlivesRequirements.lifetimes_outliving_*`) are
   declared with namespace augmentation and assigned (rustc_errors pattern).
4. AsmLabels works on `Str` (UTF-8 bytes) so `InnerSpan` offsets, `match_indices(':')` and slicing are byte-exact;
   `split(['\n', ';'])` and `match_indices(':')` scan bytes (ASCII separators).
5. ExplicitOutlivesRequirements `sort_unstable_by_key(lo_hi)` uses std/slice_sort.ts `slice_sort_unstable_by` with
   `LAYOUT_Span = { size_of: 8, freeze: true }`; `dedup_by_key` hand-written.
6. `MissingDebugImplementations`: `non_blanket_impls_for_ty(..).next().is_some()` takes only the first element of the iterable.

## Wiring for root
`rustc_lint::check_crate(tcx)` is called from rustc_interface passes.rs:1244 `analysis` (misc_checking_3, `sess.time("lint_checking",
|| rustc_lint::check_crate(tcx))`, after `effective_visibilities`/privacy). `analysis` itself is still `unported` in
passes.ts, so there is no single call to add; wire it when `analysis` is ported (`check_crate` and `lint_mod` are ready; the
combined pass needs every late lane's passes before it runs without UNPORTED).
