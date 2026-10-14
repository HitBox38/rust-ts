# Handoff: lower-lib-b (wave 14, M3a): rustc_ast_lowering lib.rs 1757..3401

Branch `lane/lower-lib-b` (from main 935a15a, no merges). Commits: 3932e87 (port), 96c731f (tests), 7012171, de7dc54.

## Files touched
- `src/rustc_ast_lowering/lib.ts`: only the `---- lane lower-lib-b imports ----` block and the
  `==== lane lower-lib-b: lib.rs:1757..3401 ====` region. lib-b's `unported_methods` list is gone, because every
  method is ported.
- `src/rustc_ast_lowering/lib_b.test.ts` (new): 12 unit tests.

## Coverage
- `bun scripts/coverage.ts --missing compiler/rustc_ast_lowering/src/lib.rs`: **nothing missing in 1757..3401**.
  The file total is 65/118; the 53 still missing are all in lower-lib-a's range.
- In my range, 62 fns are ported, in upstream order, each with its marker:
  - the 58 `LoweringContext` methods, `emit_bad_gca_macro` .. `elided_dyn_bound`;
  - `GenericArgsCtor::{is_empty, into_generic_args}`;
  - `UnrepresentableConstArgError::{new, emit}`.
- Also written: the `DirectConstArgContext` bitflags type and the consts of its `impl` (`STABLE`, `GCA`,
  `GCA_BASE_FEATURES`, `GCA_MIN_CONST_ITEMS`, `GCA_ADTS`).
- `bun scripts/coverage.ts --check`: `markers ok (8706; vendor 3888)`.

## Checks
- `bunx tsc --noEmit -p .`: clean. It is also clean for lib.ts with `--noUnusedLocals`.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: **3997 pass, 1 skip, 0 fail**, run at 96c731f.
  The later commits change only types, a comment and one test literal; for those I re-ran tsc and
  `bun test src/rustc_ast_lowering` (20 pass).
- `--suite parse --sample 100`: **100/100 MATCH** (run `20261014-025348-lower-lib-b-y8bf`).
- `--suite expanded --sample 100`: **99 MATCH, 1 UNPORTED, 0 DIFF** (run `20261014-025357-lower-lib-b-dvoh`).
  - The UNPORTED case is `tests/ui/track-diagnostics/track8.rs`, stopped at `std::panic::Location::caller`.
  - It is a known stop, already recorded as a decision, and it is not protected.
- `--suite hir-tree-nocore --sample 100`, in a scratch worktree with `lane/harness-w13` merged (since deleted):
  11 MATCH, 89 UNPORTED, 0 DIFF (run `20261014-025522-lower-lib-b-uj3j`).
  - **Stop histogram:** all 89 stop at `rustc_driver_impl::pretty::print (HirTree: needs a TyCtxt)`. No case
    reaches lowering yet.
  - The merge with harness-w13 conflicts in `harness/suites.ts`: main's tydump/thirdump block and the
    hir-tree block were added at the same place.
- **Compatibility check** (scratch merge of all 8 lowering/middle-hir lane branches as of now, then deleted):
  - All merges were clean.
  - After deduplicating the two lib.ts import blocks, my region type-checks against lower-lib-a's hand-written
    types, lower-expr's `WillCreateDefIdsVisitor` and lower-index-diag's generated diagnostics.
  - `lib_b.test.ts` passes on the merged tree.

## `unported(...)` left (all in lib.ts)
1. `rustc_hir::target_impls::<impl From<&GenericParam> for Target>::from`, in `lower_generic_param`.
   - rustc_hir/src/target_impls.rs has 6 small `From` impls, and no lane owns that file.
   - **This stops every generic parameter.** Root: assign it; it fits a rustc_hir follow-up.
2. `rustc_middle::middle::lang_items::TyCtxt::is_lang_item`, in `validate_relaxed_bound`.
   - It is reached only by `?Trait` in a forbidden position when the trait resolves.
3. `rustc_ast_lowering::expr::WillCreateDefIdsVisitor`. Self-healing: it disappears once lower-expr merges (see PORT 2).
4. `rustc_ast_lowering::diagnostics::GenericParamDefaultInBinder`. Self-healing: it disappears once lower-index-diag
   merges (see PORT 2).

## `// PORT:` decisions (please record)
1. **Views of lower-lib-a's types.**
   - `PerOwnerLoweringStateView`, `RelaxedBoundPolicyView`, `RelaxedBoundForbiddenReasonView` and `FnDeclKindView`
     are type-only. They are used as parameter types and in casts, because on this branch lib.ts still aliases
     those types to `unknown`.
   - Each has the generated shape, which is also lower-lib-a's hand-written shape (RelaxedBoundPolicy's map is
     their `DefIdMap<Span>`), so it stays assignable after the merge.
   - `relaxed_bound_policy_allowed()` builds `RelaxedBoundPolicy::Allowed(&mut Default::default())` with a
     `DefIdMap<Span>`. The generator's `Map<DefId, Span>` would key `DefId` objects by identity.
     lower-lib-a made the same choice.
2. **Late-bound cross-lane values.**
   - `WillCreateDefIdsVisitor()` reads `expr.WillCreateDefIdsVisitor` at call time, and
     `GenericParamDefaultInBinder()` reads `diagnostics.GenericParamDefaultInBinder_diagnostic` at call time.
   - Both are `unported` until the export exists, and both work unchanged after the merge (verified in the
     scratch merge).
   - Root may inline them: `new expr.WillCreateDefIdsVisitor()` and
     `diagnostics.GenericParamDefaultInBinder_diagnostic({ span })`.
3. **`rbp.reborrow()`** (lib.rs:457, in `lower_param_bounds_mut`).
   - The call passes `rbp` itself. In TS a re-borrow is the same map and the same reason, and this branch has no
     value `RelaxedBoundPolicy`.
   - Root: write `RelaxedBoundPolicy.reborrow(rbp)` (lower-lib-a's companion). Verified to compile in the scratch merge.
4. **My three lib.rs types are written as codegen generates them.** These are `GenericArgsCtor`,
   `DirectConstArgContext` (flags companion + Debug) and `UnrepresentableConstArgError` (+ Debug).
   - I compared them against a scratch run of a `rustc_ast_lowering` set; lower-lib-a did the same for its own types.
   - Their impls attach by interface merging and a `declare namespace` (`UnrepresentableConstArgError.new`, in the
     hir.ts style).
   - The `impl DirectConstArgContext` consts sit on a companion built as `{ ...flags, STABLE, ... }`.
   - Once lib.gen.ts lands: drop the generated parts and attach the impls through `declare module "./lib.gen.ts"`.
     lower-index-diag's branch already commits a lib.gen.ts, so root has to pick one source.
5. **`impl Iterator` returns are generators.** These are `lower_generic_params_mut` and `lower_param_bounds_mut`. They
   stay lazy, so `HirId`s are allocated in upstream order when callers interleave.
6. **Arenas.** `alloc(x)` is `x`. `alloc_from_iter` over a `slice.iter().map` is `.map`; over the lazy iterators
   above it is `this.arena.alloc_from_iter`.
7. **`*modifiers` copies of `ast::TraitBoundModifiers`** use `clone_TraitBoundModifiers` (PORTING §8).
   `ConstArg`/`Ty` are constructed as `<null>` (`Unambig = ()`).

## For root (integration)
- **lib.ts import blocks.** lower-lib-a and lower-lib-b import many of the same names, so the merge gives
  `Duplicate identifier` errors. To fix:
  - keep lower-lib-a's block;
  - reduce mine to `ast`, `ControlFlow`, `attr_ir`, `E0203`, `debug_DefKind`, `DefKind_eq`, `debug_Span`, `DUMMY_SP`,
    `debug_Ident`, `debug_Symbol`, `display_Symbol`, `Debug`, `debug_bool`, `debug_struct`, `debug_tuple`,
    `unreachable`, `unwrap_result`, `to_writer`, `flags_companion`, `diagnostics`, `expr`;
  - turn lower-lib-a's `import type { Target }` and `import type { DesugaringKind }` into value imports.

  This exact set compiled in the scratch merge.
- **Errors from other lanes' files** in the full scratch merge, for their owners:
  - `item.ts:1621` and `:1785` build `Allowed(new Map())`, which needs `DefIdMap`;
  - `item.test.ts:45` and `expr.test.ts:70` have fake owners that miss fields of the now-real types;
  - `path.test.ts` "segments need the generated GenericArgsCtor" expects the old stub;
  - lower-lib-a's `lib.oracle.test.ts` fixture Fingerprints depend on the checkout path. It fails outside its own
    worktree, the same issue merge-w13 fixed in `hir.oracle.test.ts` with `--remap-path-prefix`.
- `docs/next.md`: rustc_hir `target_impls.rs` (item 1 of the unported list) is the most frequent stop once
  lowering is wired.
