# Handoff: lint-late-b (wave 21: late lints, part b)

Branch `lane/lint-late-b`, base `970d2365`, with `lane/lint-late-a`'s contract commit `22ff2d95` merged in (late.rs
driver, typed `LateContext`, `src/rustc_lint/late_oracle/run.ts`), which the tests here need.

## Files touched
- `src/rustc_lint/types.ts`: port of types.rs (`TypeLimits`, `VariantSizeDifferences`, `InvalidAtomicOrdering`, the
  nullable-pointer / transparent helpers used by improper_ctypes). Replaces the lint-early-a stub.
- `src/rustc_lint/types/literal.ts`: port of types/literal.rs. Replaces the stub.
- `src/rustc_lint/types/improper_ctypes.ts`: port of types/improper_ctypes.rs (`ImproperCTypesLint`). Replaces the stub.
- `src/rustc_lint/types.oracle.test.ts` (new): oracle tests (13 cases).

## Coverage
- `compiler/rustc_lint/src/types.rs` 28/28, `types/literal.rs` 11/11, `types/improper_ctypes.rs` 39/39.
- `bun scripts/coverage.ts --check`: markers ok.

## Registration
Nothing to register: lib.ts already lists the four passes with the right constructors (`ImproperCTypesLint.default()`,
`new InvalidAtomicOrdering()`, `TypeLimits.new()`, `new VariantSizeDifferences()`); the `unported_methods` stubs are gone
(all `LateLintPass` methods upstream implements are ported). Pattern as lint-late-a's handoff: generated unit structs
get prototype methods (`declare module "./types.lints.gen.ts"`), `TypeLimits` / `ImproperCTypesLint` are classes here.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_lint/types.oracle.test.ts`: 13 pass (9 byte-identical with rustc, 4
  PENDING pins, see below). Full `bun test src`: see the end of this file.
- `difftest --suite tydump-minicore`: 45/46 MATCH, 1 UNPORTED (mini_core_hello_world.rs, `const_eval_poly`), as on the
  base. `difftest --suite hir-tree --sample 300`: 300/300 MATCH.

Oracle cases (subject `late_oracle/run.ts --late-pass=..`, std lib, `--emit=metadata`), all identical to rustc:
unused_comparisons; overflowing_literals (decimal, negated, hex/binary with sign-bit and suffix suggestions, `isize`,
`i64::MIN`, casts to `char`: too large / surrogate / only-u8, exclusive range endpoints incl. through a cast);
invalid_nan_comparisons (both sides, `!=`, through a block, `<`); unpredictable_function_pointer_comparisons
(`Option<fn()>`, `<`, `PartialOrd::lt`); variant_size_differences (repr(u8), generic, `#[allow]`, niche);
invalid_atomic_ordering (load / store / fence / compiler_fence / compare_exchange(_weak) / try_update); improper_ctypes
fn-pointer checks of fields, aliases, statics, consts, Rust fns, trait methods and an `extern "Rust"` block (no
emission); all four passes combined in lib.rs order.

## Stops in code that is not this lane's (PENDING cases pin them)
1. `rustc_lint::utils::std_or_core` (utils.ts stub): every `ambiguous_wide_pointer_comparisons` emission and the
   `fn_addr_eq` suggestion of `unpredictable_function_pointer_comparisons` stop there. utils.rs needs an owner.
2. `ImproperCTypes::into_diag` (diagnostics.ts, `unported` "IntoDiagArg for Ty"): every improper_ctypes(_definitions)
   emission. `Ty_into_diag_arg` exists now (rustc_middle/ty/diagnostics.ts), so it can be ported.
3. `TyCtxt::type_id_hash` -> `Ty: StableHash` (rustc_middle): `ImproperCTypesLint::cache_key`, i.e. every `extern "C"`
   fn declaration / definition and foreign static, stops there.
4. `UnpredictableFunctionPointerComparisonsSuggestion::FnAddrEqWithCast` renders `fn_sig` with `unported_display`
   (diagnostics.gen.ts; `Binder<FnSig>` Display) once (1) is fixed.
5. Float literals: `float_is_infinite` needs rustc_apfloat (`IeeeFloat::from_str`); it is `unported` here. NOTE for root:
   once `check_crate` runs the real combined pass, every crate with a float literal in a body stops there until
   vendor-apfloat lands.
6. `uses_power_alignment` is untested: the `powerpc64-ibm-aix` target spec is not ported.
7. Seen while testing (not in my code): layout of `NonZero<u32>` (pattern types) stops in
   `try_fold_with_PatternKind` / const eval, so `transparent_newtype_field` on `NonZero` stops.

## `unported(...)` left
- `rustc_apfloat::ieee::IeeeFloat::from_str (rustc_apfloat is not ported)` in literal.ts `float_is_infinite`.

## `// PORT:` decisions
- types.ts: the passes are standalone `LateLintPass` objects; `cx.typeck_results()` is `cx.typeck_results_()`;
  `cx.layout_of(ty)` is a local `late_layout_of` (`LayoutOf::spanned_layout_of(ty, DUMMY_SP)` with `LateContext`'s
  `LayoutOfHelpers`: `tcx.at(DUMMY_SP).layout_of(typing_env.as_query_input(ty))`, errors through
  `handle_layout_err`) because `LateContext` has no `layout_of`; no `pub(crate) use improper_ctypes::ImproperCTypesLint`
  re-export (it would make types.ts and improper_ctypes.ts import each other; lib.ts imports improper_ctypes.ts);
  `debug!` calls are comments; fn-local helpers of `check_expr` (`is_valid`, `rev_binop`, `check_limits`,
  `is_comparison`, `diag_item_cmpop`) and of `lint_nan` are module-level / nested functions with their markers.
- literal.ts: `OVERFLOWING_LITERALS` imported from types.lints.gen.ts (no import cycle with types.ts);
  `float_is_infinite<S: Semantics>` takes the `FloatTy` the caller picked.
- improper_ctypes.ts: `known_safe: RefCell<FxHashSet<(Hash128, u8)>>` is a `Set<string>` keyed `${hash}:${flags}`;
  `bitflags! RootUseFlags` is a number with the flag consts on a companion; `msg!` is rustc_errors' `msg`;
  `FnPtrFinder` (one struct, two traits that both name their method `visit_ty`) is a plain object with one class per
  impl (`FnPtrFinder_HirVisitor`, `FnPtrFinder_TypeVisitor`); `ProhibitOpaqueTypes` at module level;
  `cfg!(debug_assertions)` in `visit_indirection` is false (rustc ships without debug assertions).

## Full `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000`
5409 pass, 1 skip, 1 fail. The failure is not from this lane: `src/std/result.test.ts` "non-test code never reaches the
one-argument unwrap_result" flags `src/rustc_lint/context.ts:697` (`get_def_path`), which comes from lint-late-a's merged
commit 22ff2d95 (context.ts is that lane's file). lint-late-a has a later commit (ed5df268, "LayoutOf for LateContext")
that root merges anyway. When it lands, `late_layout_of` in types.ts can become `cx.layout_of(ty)`.
