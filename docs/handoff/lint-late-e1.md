# Handoff: lint-late-e1 (wave 21, M4-0: small late lint files, part e1)

Branch `lane/lint-late-e1`, based on 970d2365. No merges.

## Result
The late-lint parts of the 15 assigned files are ported in full, in upstream order, with markers. Each pass follows the
pattern in lane lint-late-a's handoff: a `declare module` that makes the generated pass type a `LateLintPass`, plus
prototype assignments. The `unported_methods` stubs are gone. **No registration change is needed.** lib.ts's
`BuiltinCombinedLateLintModPass` / `InternalCombinedLateLintModPass` (DisallowedPassByRef) already list every pass
with its correct constructor (all are `declare_lint_pass!` unit structs, `new X()`).

## Files
- Ported (hand): `src/rustc_lint/{async_closures, async_fn_in_trait, autorefs, c_void_returns, default_could_be_derived,
  deref_into_dyn_supertrait, disallowed_pass_by_ref, enum_intrinsics_non_enums, for_loops_over_fallibles,
  function_cast_as_integer, gpukernel_abi, implicit_provenance_casts, interior_mutable_consts, invalid_from_utf8,
  let_underscore}.ts`.
- Test (new): `src/rustc_lint/late_passes_e1.oracle.test.ts` (27 cases). Its driver is
  `src/rustc_lint/late_passes_e1_oracle/run.ts` + `walker.ts`.
  - `walker.ts` is a test stand-in for late.rs's `LateContextAndPass`, because lint-late-a's late.ts was not on this
    lane's base. `$RUST_TS_E1_PASSES` selects the passes to run.
  - **Root, after merging lint-late-a:** switch the test to `src/rustc_lint/late_oracle/run.ts --late-pass=<file>.ts:<Pass>`
    and delete `late_passes_e1_oracle/`. The case list and the comparison stay the same.

## Coverage (`bun scripts/coverage.ts --missing`)
All 15 files are complete: async_closures 1/1, async_fn_in_trait 1/1, autorefs 4/4, c_void_returns 4/4,
default_could_be_derived 2/2, deref_into_dyn_supertrait 1/1, disallowed_pass_by_ref 3/3,
enum_intrinsics_non_enums 4/4, for_loops_over_fallibles 4/4, function_cast_as_integer 1/1, gpukernel_abi 3/3,
implicit_provenance_casts 3/3, interior_mutable_consts 1/1, invalid_from_utf8 1/1, let_underscore 1/1.
`bun scripts/coverage.ts --check`: markers ok (17318; vendor 3888).

## Oracle tests
Both sides compile each case as a lib (`--emit=metadata -A unused`, x86_64-unknown-linux-gnu, std). Stderr and the
exit code must be byte-identical. A case with `stop` may instead end with exit 70 at one of its listed stops, which
are outside this lane. In that case, everything printed before the stop must be a prefix of the oracle's stderr.
Most cases are upstream tests/ui files, run whole.

**On this lane's base** (context.rs late methods still stubs): 27/27 pass.
- Full matches:
  - `implicit_autorefs.rs`: 20 errors, including overloaded deref and `#[rustc_no_implicit_autorefs]` methods.
  - `async-await/in-trait/warn.rs`: with the `impl Future + Send` desugaring suggestion.
  - `internal-lints/rustc_pass_by_value_self.rs`: `SelfTyAlias`, `def_path_str_with_args`, generic args.
  - `function_casts_as_integer.rs`.
  - `lint-strict-provenance-fuzzy-casts.rs` (int2ptr).
  - for_loops_over_fallibles: `macro-iterator-next.rs`, `macro-issue-140747.rs`, and an inline case with
    `Option`, `&Option`, `Result` and `.next()`.
  - const_item_interior_mutations: an inline case with `Cell`, atomics, an assoc const, and Spanful suggestions.
  - Each lint also has at least one inline case with no diagnostic.
- Stops:
  - `LateContext::qpath_res` (c_void_returns, enum_intrinsics_non_enums, invalid_from_utf8).
  - `typing_env` (let_underscore, the `?` suggestion of for_loops_over_fallibles).
  - `precedence` (ptr2int).
  - `get_associated_type` (deref_into_dyn_supertrait).

**On a scratch merge with `lane/lint-late-a` @ 22ff2d95** (its context.ts ports those methods; merge clean, `tsc` clean,
not committed): 27/27 pass, and these upstream tests match **in full**:
- `lint/c-void-returns.rs`
- `lint/lint-enum-intrinsics-non-enums.rs`
- `lint/for_loop_over_fallibles.rs` (`?` suggestion through `ObligationCtxt`)
- `lint/lint-strict-provenance-lossy-casts.rs`
- `lint/invalid_from_utf8.rs`
- `lint/let_underscore/let_underscore_drop.rs` and `let_underscore_lock.rs`
- `lint/issue-108155.rs`

Remaining stops after that merge:
- `deref-upcast-shadowing-lint.rs` gets through the whole pass and stops in the generated `SupertraitAsDerefTarget`
  diagnostic: `unported_into_diag_arg` for `Binder<ExistentialTraitRef>` (codegen typemap).
- `let_underscore/issue-11969{6,7}*.rs` stop at `mir_borrowck provider` in the analysis prefix (async fns). They are
  not among the test cases.

Cases that cannot reach the lint at all:
- gpukernel_abi: no GPU target spec is ported (`rustc_target::spec::targets::nvptx64_nvidia_cuda`). On x86_64,
  `extern "gpu-kernel"` is E0570. The nvptx case records the stop, and an x86 case covers the early return.
- default_overrides_default_fields: default field values hit `TyCtxt::const_eval_poly (M4)` in the analysis prefix.
- closure_returning_async_block: the lint logic runs (allow-by-default case matches). The diagnostic stops at the
  local `#[derive(Diagnostic)]`, see below.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: ok.
- `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000`: 5423 pass, 1 skip, 0 fail (363 files).
- tydump-minicore: 45/46 MATCH, 1 UNPORTED, the same as base 970d2365 (runs `e1-base-tydump-minicore` /
  `e1-lane-tydump-minicore`). `hir-tree --sample 300`: 299/300, 1 UNPORTED, with the same failing case as base
  (runs `e1-base-hirtree` / `e1-lane-hirtree`).

## unported(...) left
- `rustc_lint::async_closures::ClosureReturningAsyncBlock (#[derive(Diagnostic)], tools/codegen set rustc_lint)`.
  `ClosureReturningAsyncBlock` / `AsyncClosureSugg` are derive structs local to async_closures.rs, and
  tools/codegen's `rustc_lint` set reads only diagnostics.rs. The data structs are kept as interfaces.
  **Root:** add `compiler/rustc_lint/src/async_closures.rs` to `types.sets.json` → `rustc_lint.files` (it generates
  `async_closures.gen.ts`), then replace the stub `ClosureReturningAsyncBlock_diagnostic` with the generated one.
- Reached but owned elsewhere: the context.rs stubs on this base (ported by lint-late-a), and
  diagnostics.gen.ts `unported_into_diag_arg` for `SupertraitAsDerefTarget.{supertrait_principal,target_principal}`
  (`Binder<ExistentialTraitRef>` IntoDiagArg, codegen typemap).

## PORT decisions (root: please record)
1. `LateContext::typeck_results()` is `cx.typeck_results_()`. Where this base types a context member `unknown`
   (`typeck_results_()`, `qpath_res`, `typing_env`, `precedence`, `get_associated_type`,
   `expr_or_init_with_outside_body`, `enclosing_body`, `param_env`), the call site casts it to the upstream type.
   After lint-late-a's typed context.ts, these casts are no-ops and can be dropped.
2. `find_attr!(tcx, def_id, Pat)` is `find_attr(HasAttrs_DefId/LocalDefId.get_attrs(..), k => k.$ === "Pat" ? null : undefined) !== undefined`
   (the traits/misc.ts precedent).
3. Upstream `while let` / let-chains are early `return`s in the same order. Matches on HIR slices (`[arm]`,
   `[_, some_arm]`, `[field]`, `[receiver, ..]`) check lengths explicitly.
4. gpukernel_abi `CheckGpuKernelTypes` is a class implementing `TypeFolder` (erase_regions.ts precedent). Its
   non-overridden methods forward to `TypeFolder_provided`. `iter::zip(sig.inputs(), decl.inputs)` stops at the
   shorter list.
5. invalid_from_utf8: `std::str::from_utf8` is std/str.ts `from_utf8`. `LitKind::Int(b) => b.get() as u8` is
   `Number(BigInt.asUintN(8, b))`. A local `strip_prefix` helper stands for `str::strip_prefix`.
6. `ExprPrecedence`'s derived `PartialOrd` compares `ExprPrecedence_discriminant` (rustc_ast parser.gen.ts).
7. deref_into_dyn_supertrait: the `TraitRef` / `ExistentialTraitRef` fold descriptors are local consts
   (traits/vtable.ts precedent). `supertraits(..).find(..)` is a `next()` loop.
8. default_could_be_derived: `WrongDefaultImpl`'s hand-written `Diagnostic` impl is ported as
   `WrongDefaultImpl_into_diag` + `_diagnostic` (the diagnostics.ts precedent).
