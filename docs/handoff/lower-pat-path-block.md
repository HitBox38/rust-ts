# Handoff: lower-pat-path-block (wave 14, M3a): rustc_ast_lowering pat.rs, path.rs, block.rs

Branch `lane/lower-pat-path-block` (from main 935a15a, no merges).

## Files touched
- `src/rustc_ast_lowering/pat.ts`: pat.rs, all 15 methods in upstream order with markers.
- `src/rustc_ast_lowering/path.ts`: path.rs, all 8 methods.
- `src/rustc_ast_lowering/block.ts`: block.rs, all 6 methods.
- new `src/rustc_ast_lowering/pat_path_block.test.ts`: 22 unit tests (see "Tests").

Nothing else was edited: no decls.ts, lib.ts, diagnostics.ts, codegen or harness change.

## Coverage
`bun scripts/coverage.ts --missing compiler/rustc_ast_lowering/src/<f>.rs`: pat.rs 15/15, path.rs 8/8, block.rs 6/6.
`bun scripts/coverage.ts --check`: markers ok.

## The PORT(pending-gen) bridge (root: remove it on integration)
The wave started before codegen set `rustc_ast_lowering` ran. So lib.ts still aliases the lib.rs types to
`unknown`, and diagnostics.ts has no diagnostic structs. I did not edit those files. pat.ts and path.ts each have
one block marked `---- PORT(pending-gen) ----`. It stands in for the generated exports, with the same names and
shapes. I checked those against a scratch run of `bun tools/codegen/types.ts rustc_ast_lowering --out /tmp/..`;
the set entry was applied temporarily and reverted.
- **Values of the lib.rs enums** are written as the generator emits them. Fieldless enums are strings:
  `"Optional"`, `"No"`, `"Err"`, `"Variable"`. Data enums are literals: `{ $: "Disallowed", _0: "Path" }`,
  `{ $: "FeatureGated", _0, _1 }`, `{ $: "AlreadyErrored", _0: guar }`. These need no change once the real types
  exist; tsc will check them then.
- **Diagnostics.** A local `diagnostics_` object has one wrapper per emitted struct:
  - pat.ts: `SubTupleBinding`, `ExtraDoubleDot`, `MisplacedDoubleDot`, `ArbitraryExpressionInPattern`;
  - path.ts: `GenericTypeWithParentheses`, `BadReturnTypeNotation`, `AsyncBoundNotOnTrait`,
    `AsyncBoundOnlyForFnTraits`.

  Each wrapper calls `diagnostics.<X>_diagnostic` through `pending_gen`, which stops as UNPORTED while the export is
  missing. **Integration:** replace `diagnostics_.` with `diagnostics.` (the namespace import is already there),
  then delete the object.
- **`GenericArgsCtor`.** `new_GenericArgsCtor(args, constraints, parenthesized, span)` does `new
  lib.GenericArgsCtor(..)` through `pending_gen`. It assumes the generated class takes its fields in declaration
  order, and that `is_empty` / `into_generic_args(this)` exist as methods (lane lower-lib-b). `GenericArgsCtorView`
  types it. **Integration:** use `new GenericArgsCtor(..)`, and drop the view and the `as [GenericArgsCtorView,
  boolean]` casts.
- **`curr_owner`.** `PerOwnerLoweringStateView` covers the fields I read: `ident_and_label_to_local_id`,
  `owner_id()` and `owner`. **Integration:** drop the casts.
- **`ImplTraitContext` match.** `matches!(itctx, ImplTraitContext::OpaqueTy { .. })` reads
  `(itctx as { $: string }).$` (path.ts `lower_parenthesized_parameter_data`). **Integration:** drop the cast.
- **`GenericArgsMode` default arms.** The two `switch (generic_args_mode)` in `lower_path_segment` have a
  `default: unreachable()` arm with a PORT note, because TS cannot see the match is exhaustive on `unknown`.
  **Integration:** remove both arms.

Root should also keep `pending_gen`'s UNPORTED text in mind:
`rustc_ast_lowering::<name> (pending codegen set rustc_ast_lowering)`.

## `unported(...)` left
- The bridge above (`pending_gen`), until codegen set rustc_ast_lowering lands.
- path.ts `tcx_method`: `TyCtxt::lang_items` (rustc_middle ty/context.rs:995), and `fn_trait_kind_from_def_id` /
  `async_fn_trait_kind_from_def_id` (rustc_middle middle/lang_items.rs:38/:50), are not ported. The call site
  resolves them dynamically, so a later port is picked up with no edit here. Until then:
  - **every trait path** lowered by `lower_qpath` (`res = Def(Trait, _)`, path.rs:75) stops as
    `rustc_middle::middle::lang_items::TyCtxt::async_fn_trait_kind_from_def_id`;
  - `map_trait_to_async_trait` stops as `rustc_middle::ty::context::TyCtxt::lang_items`.

  These need a rustc_middle lane: lang_items.rs plus `TyCtxt::lang_items` over the `get_lang_items` query.

## `// PORT:` decisions
1. **Runtime HIR import.** HIR values come from `import * as hir from "../rustc_hir/lib.ts"`. This is a runtime
   import (classes `hir.Pat`, `hir.Path`, `hir.Block`, ...), whereas decls.ts's `hir_shim.ts` is type-only; it
   mirrors `use rustc_hir as hir`. Classes are built with `new` and their fields in declaration order. Where
   upstream's struct literal evaluates side-effecting fields (`next_id()`, `lower_ident`, `lower_res`) in a
   different order, those fields are computed into locals first, in source order. Examples: `lower_pat_ident`'s
   segment `next_id` before the `PatExpr`'s, `PathSegment`, `AssocItemConstraint`, `hir::Path`'s segments before
   its span.
2. **Iterator positions.** The `iter.by_ref()` loops (`lower_pat_tuple`, `lower_pat_slice`) and
   `while let [s, tail @ ..]` (`lower_stmts`) are index loops that share the iterator position.
3. **`lower_pat_mut`'s `loop`** is a labelled `for (;;)`. `PatKind::Paren` reassigns `pattern`, so the result keeps
   the outer HirId and takes the inner pattern's span, as upstream does.
4. **Copied `BindingMode`.** `*binding_mode` and `&ann` copies of the AST `BindingMode` are `clone_BindingMode`
   (PORTING §8).
5. **Erased `Arc`s.** `Arc::clone(&crate::ALLOW_*)` / `.clone()` of `Option<Arc<[Symbol]>>` share the frozen
   arrays (contract decision). `Span::default()` is `DUMMY_SP`. `ast::StrStyle::Cooked` is `{ $: "Cooked" }`.
6. **Removed macro calls.** `debug!` and `#[instrument]` are comments. `expected_lifetimes` is still computed
   (it only feeds a `debug!`).
7. **`insert_many`.** `SmallVec::insert_many(0, (start..end).map(..))` builds the lifetimes in order, then
   `splice(0, 0, ..)`.
8. **Indexing panics.** `map[&id]` is `unwrap(map.get(id), "no entry found for key")`.
   `assert!(!res.is_empty())` uses the message `assertion failed: !res.is_empty()`.

## Tests
- `pat_path_block.test.ts`: 22 tests over a `LoweringContext` whose lib/expr collaborators are fakes.
  `lower_node_id` is memoized per NodeId, `next_id` is sequential. Expected HIR and HirId order come from upstream
  (line numbers in the test names). They cover:
  - blocks: stmts, tail expression, Let/Semi HirId order, `alias_attrs`/`lower_attrs` calls, `MacCall` panic,
    check modes, the `impl_trait_in_bindings` gate;
  - tuple and slice patterns: `..` and `x @ ..`, DotDotPos, sub-slice `x @ _`;
  - or-pattern binding sharing, ident-to-path patterns, paren peeling, ref/deref/range, range ends;
  - `lower_expr_within_pat`: literals, negation, errors, included bytes;
  - type patterns;
  - `assoc_ty_binding` and the `lower_use_path` assert;
  - the pending stops (diagnostics, GenericArgsCtor, lang items) report their UNPORTED paths.
- Checks: see "Results" below.

## Results
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4007 pass, 1 skip (the pre-existing linux-only
  test), 0 fail.
- `bun scripts/coverage.ts --check`: markers ok (8673; vendor 3888).
- Fresh-process loads: pat.ts, path.ts, block.ts and lib.ts each load as an entry point.
- `bun scripts/difftest.ts --suite parse --sample 100`: 100/100 MATCH (run `20261014-025159-lower-pat-path-block-6gz5`).
- **End to end, in a throwaway worktree** (`tmp/lppb-e2e`, lane branch + `git merge --no-ff lane/harness-w13`):
  - The merge conflicted in `harness/suites.ts`, where both sides add suites at the same spot. For the experiment
    only, I took harness-w13's version. The worktree and branch were deleted afterwards; the lane branch is
    unmerged.
  - `--suite hir-tree-nocore --sample 100`: 11 MATCH, 0 DIFF, 89 UNPORTED, 3 skipped (run
    `20261014-025211-lower-pat-path-block-8ptr`).
  - Stop histogram:
    - 87 × `rustc_driver_impl::pretty::print (HirTree: needs a TyCtxt)`;
    - 2 × `rustc_expand::proc_macro::BangProcMacro::expand (quote!; proc-macro bridge, M6)`.
  - Lowering is not reached yet: the driver stops before `lower_to_hir`. The 11 matches are cases that fail
    before HIR.

## For root
1. Run codegen set `rustc_ast_lowering` (lanes lower-lib-b and lower-index-diag both carry an uncommitted
   `types.sets.json` entry for it; they must not conflict). Then remove the pending-gen bridge as listed above.
   tsc then type-checks the enum literals.
2. Lowering is not reachable from any suite until lower-lib-a ports `lower_to_hir` and `provide` is wired, so no
   suite output changes with this lane.
3. A rustc_middle lane is needed for lang_items.rs + `TyCtxt::lang_items` (see `unported` above). Otherwise every
   trait path stops.
