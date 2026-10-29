# Handoff: gaps-30a (wave 30, M4 tail): the binder/relate stops

Branch `lane/gaps-30a`, from main `bbbe6dd3`; no merges.

## Stops ported

| # | stop | where | upstream |
|---|---|---|---|
| 1 | `ty_is_opaque_future` (`EarlyBinder::skip_binder` of `explicit_item_self_bounds`) | `src/rustc_middle/ty/context.ts` | `rustc_middle/src/ty/context.rs:2099` |
| 2 | `get_impl_future_output_ty` (`iter_instantiated_copied`) | `src/rustc_middle/ty/context.ts` | `rustc_middle/src/ty/context.rs:2851` |
| 3 | `impl Relate for ty::Expr` (`relate_Expr`) | `src/rustc_type_ir/relate.ts` | `rustc_middle/src/ty/relate.rs:102` |
| 4 | `<FnCtxt as HirTyLowerer>::select_inherent_assoc_candidates` | `src/rustc_hir_typeck/fn_ctxt/mod.ts` | `rustc_hir_typeck/src/fn_ctxt/mod.rs:319` |
| 5 | "visit_with of a Binder's value (generated caller passed no visit impl)" | `tools/codegen` + `src/rustc_type_ir/binder.ts` | see below |

Notes:
- Stop 1 and stop 2 use `EarlyBinder.skip_binder` / `EarlyBinder.iter_instantiated_copied`. Both already existed in
  binder.ts; the context.ts bodies were only placeholders.
- Stop 3 needs no new helper: it relates `Expr.args` with `relate_GenericArgs` (relate_args_invariantly) and builds the
  result with `Expr.new`.
- Stop 4 uses `with_replaced_escaping_bound_vars` and `predicates_for_generics` (both ported by now) and a local
  `TypeFoldable<InherentAssocCandidate>` descriptor built from the generated impls.

### Stop 5: root cause, fixed at the generator
The generated `TypeFoldable` impls passed only `T`'s impl of the same kind to `try_fold_with_Binder` /
`fold_with_Binder`, so `fold_Binder` got a partial descriptor of `T`. A folder's `fold_binder` can visit the bound
value, and then `d.visit_with` stopped as UNPORTED. Stack (tests/ui/unsafe-binders/simple.rs):
`fold_with_UnsafeBinderInner` (ty_kind.gen.ts) → erase_regions `fold_binder` → `anonymize_bound_vars` →
`has_vars_bound_at_or_above` → `d.visit_with`.

Fix:
- `tools/codegen/types.ts`:
  - `TypeFoldMap.fold_also_visit`: item keys of hand impls whose `try_fold`/`fold` fns also take the `visit` impls of
    their type arguments, after their own.
  - `$vN` in a `type_fold.json` `try_fold`/`fold` name: the visit impl of type argument N. It adds no TS type argument.
  - Both are left out when the visit impl would need a type parameter of the enclosing item, because a fold fn is not
    passed that (`tfVisitFn`).
- `tools/codegen/type_fold.json`:
  - `"fold_also_visit": ["rustc_type_ir::binder::Binder"]`;
  - the `rustc_middle::ty::Binder` entry is now `try_fold_with_Binder($0, $v0)` / `fold_with_Binder($0, $v0)`;
  - the `//` doc is updated.
- `src/rustc_type_ir/binder.ts`: `try_fold_with_Binder` / `fold_with_Binder` take an optional `visit_with_T`, and the
  `partial_descriptor` fallback stays for callers that cannot pass it.
- `src/rustc_type_ir/relate.ts` `relate_Binder` (hand caller): passes `d.visit_with` too.
- Regenerated all 15 `derive_type_fold` sets. Only 5 generated files changed, and in each the only change is the
  extra visit argument:
  - `rustc_type_ir/ty_kind.gen.ts`;
  - `rustc_type_ir/region_constraint.gen.ts`;
  - `rustc_infer/infer/region_constraints/mod.gen.ts`;
  - `rustc_middle/traits/mod.gen.ts`;
  - `rustc_hir_analysis/check/wfcheck.gen.ts`.

**For root (files outside this lane):** other hand callers still pass only one impl. They can append the visit impl
the same way if a stop shows up there:
- `src/rustc_type_ir/region_constraint.ts:1266-1268` (`fold_AliasTy_Region.visit_with`);
- `src/rustc_middle/traits/mod.ts:528-546` (`PolyTraitClause` / `PolyFnSig`: `visit_with_TraitClause`, `visit_with_FnSig`).

## Files touched
- `src/rustc_middle/ty/context.ts`
- `src/rustc_type_ir/relate.ts`
- `src/rustc_hir_typeck/fn_ctxt/mod.ts`
- `src/rustc_type_ir/binder.ts`
- `tools/codegen/types.ts`
- `tools/codegen/type_fold.json`
- the 5 regenerated `.gen.ts` files listed above

## Coverage
- `compiler/rustc_middle/src/ty/context.rs`: 202/202
- `compiler/rustc_middle/src/ty/relate.rs`: 3/7 (was 2/7). The remaining 4 are the existing stand-ins without markers
  (`Ty` :12, `GenericArgs` :92, `GenericArg` :127, `Term` :148), which this lane did not touch.
- `compiler/rustc_hir_typeck/src/fn_ctxt/mod.rs`: 26/26
- `compiler/rustc_type_ir/src/binder.rs`: 108/108
- `compiler/rustc_type_ir/src/relate.rs`: 23/23
- `bun scripts/coverage.ts --check`: `markers ok (22799; vendor 4483)`
- `bunx tsc --noEmit -p .`: clean.

## The stops' cases (gate gate-20261029-001428-root-june lists, each run by `--filter`)
There were 398 cases across mir / borrowck-ui-report / thir-tree / tydump-ui. **393 now MATCH**:
- mir: 273 of 278;
- borrowck-ui-report: 97/97;
- thir-tree: 16/16;
- tydump-ui: 7/7.

All 5 non-MATCH cases are mir cases that the `Relate for ty::Expr` stop blocked before:

| case | now | next stop |
|---|---|---|
| const-generics/generic_const_exprs/infer-too-generic.rs | CRASH (ICE) | `unwrap` of `None` in `rustc_mir_transform/simplify.ts:810` `LocalUpdater::visit_local` (SimplifyLocals: a removed local is still used) |
| const-generics/generic_const_exprs/subexprs_are_const_evalutable.rs | CRASH (ICE) | same as above |
| const-generics/generic_const_exprs/poly-const-uneval-ice-106423.rs | CRASH (exit 1) | E0433 "cannot find `core` in the crate root" for `use core::mem::MaybeUninit` (edition 2015), which the oracle accepts: resolve |
| const-generics/generic_const_exprs/cannot-convert-erased-region-vid-ice-125564.rs | UNPORTED | `#[derive(Diagnostic)] rustc_hir_typeck::method::probe::probe_op::MissingTypeAnnot` |
| const-generics/transmute-fail.rs | UNPORTED | `rustc_abi::Size beyond 2^53` |

None of these is small or in this lane's area, so I left them alone. The 3 CRASHes were UNPORTED before, never MATCH,
so nothing protected is lost. They are now visible as wrong output (mir_transform and resolve), not as a stop.

## Sample difftests (`RUST_TS_AGENT=root-f5de`, `--sample 300`)
The before runs come from a clean detached worktree at `bbbe6dd3`. A first before run overlapped my edits, so I
discarded it.

| suite | before | after | lost | won |
|---|---|---|---|---|
| mir | 290 (run 20261029-094321-root-f5de-npts) | 293 (20261029-100723-root-f5de-p73o) | 0 | 3 |
| borrowck-ui-report | 279 (20261029-094626-root-f5de-zh13) | 299 (20261029-100935-root-f5de-x8g5) | 0 | 20 |
| tydump-ui | 297 (20261029-094841-root-f5de-xa95) | 297 (20261029-101216-root-f5de-ish4) | 0 | 0 |

I compared the samples case by case (same ids on both sides) and no previous MATCH was lost.

## unported(...) left
None added. Removed:
- context.ts: 2;
- relate.ts: 1;
- fn_ctxt/mod.ts: 1;
- the binder.ts `partial_descriptor` visit fallback: still there, but no generated fold caller reaches it now.

## // PORT: decisions
- context.ts: `explicit_item_self_bounds` is cast to `EarlyBinder<readonly [Clause, Span][]>`, because the query value
  is `unknown` in queries.gen.ts (as in closure.ts / note_and_explain.ts).
- context.ts `get_impl_future_output_ty`: `Option<Option<Ty>>::flatten`. Both `None`s are `undefined`, so
  `Binder.no_bound_vars(.., fold_Option(fold_Ty))` already gives the flattened value.
- fn_ctxt/mod.ts: `clauses_of` is cast to `GenericClauses` (the query value is `unknown`).
- binder.ts: the fold impls take an optional `visit_with_T` (comment above `visit_with_Binder`).

## Unit tests
`bun test src/rustc_middle/ty src/rustc_middle/traits src/rustc_type_ir src/rustc_hir_typeck src/rustc_hir_analysis/check
src/rustc_infer/infer/region_constraints tools/codegen`: **706 pass, 0 fail** (72 files). No contract or stub-count test pins
a number this lane moved.
