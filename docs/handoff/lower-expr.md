# Handoff: lower-expr (wave 14, M3a): rustc_ast_lowering expr.rs + expr/closure.rs

Branch `lane/lower-expr` (from main 935a15a, no merges kept).

## Files touched
- `src/rustc_ast_lowering/expr.ts`: the whole of expr.rs. It holds:
  - the 75 `impl LoweringContext` methods, in upstream order, with markers;
  - the nested fn `is_ordinary` (:1215), inside `lower_expr_assign`;
  - the helper types `MoveExprInitializer`, `MoveExprState`, `MoveExprOccurrence` and `FutureKind` (+ `debug_FutureKind`);
  - the two visitors, as classes extending the rustc_ast `visit.Visitor`:
    - `WillCreateDefIdsVisitor` (`Result = ControlFlow<Span>`; `visit_anon_const`/`visit_item`/`visit_expr`);
    - `MoveExprInitializerFinder` (`collect`/`collect_block` statics, `visit_expr`/`visit_item`).
  - The `unported_methods(..)` placeholder list is gone.
- `src/rustc_ast_lowering/expr/closure.ts`: the 7 methods of closure.rs. Its `unported_methods(..)` list is gone too.
- `src/rustc_ast_lowering/expr.test.ts` (new, not an upstream file): 8 unit tests (see "Tests").
- Nothing outside these files. decls.ts is unchanged: every contract signature fit as declared.

## Coverage
- `bun scripts/coverage.ts --missing compiler/rustc_ast_lowering/src/expr.rs`: **83/83 ported**.
- `bun scripts/coverage.ts --missing compiler/rustc_ast_lowering/src/expr/closure.rs`: **7/7 ported**.
- `bun scripts/coverage.ts --check`: `markers ok (8734; vendor 3888)`.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 3993 pass, 1 skip (the pre-existing linux-only
  one), 0 fail.
- `bun test src/rustc_ast_lowering`: contract.test.ts 8/8 and expr.test.ts 8/8.
- `RUST_TS_AGENT=lower-expr bun scripts/difftest.ts --suite parse --sample 100`: **100/100 MATCH** (run
  `20261014-024148-lower-expr-t1nv`).
- **hir-tree-nocore, sample 100.** I ran it in a throwaway detached worktree, with `lane/harness-w13` merged
  locally. The merge had one conflict in `harness/suites.ts` (main's tydump/thirdump block and harness-w13's
  hir block are appended at the same spot; I kept both). The worktree is deleted and nothing from the merge is on
  this branch.
  - Result: 9 MATCH, 0 DIFF, 91 UNPORTED, 0 CRASH; 3 skipped (run `20261014-024122-lower-expr-cruo`).
  - Stop histogram: 91 × `rustc_driver_impl::pretty::print (HirTree: needs a TyCtxt)`.
  - So no case reaches lowering yet. It is blocked on the driver, `LoweringContext::new` / `lower_to_hir`
    (lib-a) and `provide` wiring (root). The 9 MATCHes are cases that stop with errors before printing.

## Tests (expr.test.ts)
The tests drive expr.rs methods on an `Object.create(LoweringContext.prototype)`. The other lanes' methods are
replaced by small own-property stubs:
- a counter `next_id` / `lower_node_id`;
- identity `lower_span` / `lower_ident`;
- a recording `mark_span_with_reason`;
- a placeholder `make_lang_item_qpath`;
- `tcx.features().new_range()`.

The ASTs come from the real parser. What the tests check:
- **`MoveExprInitializerFinder`**: the order in which it collects `move(..)` initializers (inner first), and that
  it skips `const { .. }`.
- **`WillCreateDefIdsVisitor`**: it continues on plain expressions. It breaks on closures (with the closure's
  span), anon consts (`[0u8; 3]`), items in blocks and const blocks.
- **`lower_expr_mut` on `(1 + 2)`**: the paren span is widened, and HirIds are taken in order.
- **`lower_expr_range`**: the lang items for `..`, `1..2`, `..=5` and `1..=2`, with and without `new_range`.
  Also the field names `start` / `end` / `last`, the `RangeExpr` span marks, and the `RangeInclusive::new` call
  form.
- **`lower_jump_destination` / `with_loop_scope` / `with_loop_condition_scope`**: `OutsideLoopScope`,
  `UnlabeledCfInWhileCondition`, and the nested loop inside a condition. The tests also check the state
  restoration.
- **`with_move_expr_bindings`**: the push/pop.
- **`expr_ident_mut`**: the segment HirId is allocated before the expression HirId.

## `unported(...)` left
- None. expr.ts and closure.ts contain no `unported` call.
- Everything these files call in other lanes' files is still those lanes' placeholders: lib.rs, block.rs,
  path.rs, pat.rs, item.rs, asm.rs, format.rs and contract.rs (`checked_return`).

## PORT decisions (please record)
1. **Visitors are hand classes.** `WillCreateDefIdsVisitor` and `MoveExprInitializerFinder` implement
   `rustc_ast::visit::Visitor`. They are hand classes extending `visit.Visitor`, as rustc_resolve's
   `UnusedImportCheckVisitor` is. **Codegen set `rustc_ast_lowering` must list them under `hand`**:
   - `rustc_ast_lowering::expr::WillCreateDefIdsVisitor`;
   - `rustc_ast_lowering::expr::MoveExprInitializerFinder`.

   Otherwise the generator emits an `interface` / a plain `class` with the same name.
2. **Data types are pending codegen.** codegen set `rustc_ast_lowering` has not run. So expr.ts declares
   `MoveExprInitializer`, `MoveExprState`, `MoveExprOccurrence`, `FutureKind` and `debug_FutureKind`
   **verbatim as the generator emits them**. I checked this with a scratch run of the set at the pin:
   `--out /tmp/...`; types.sets.json was restored and is not changed on this branch. Once expr.gen.ts exists,
   replace that block with `export * from "./expr.gen.ts"`.
3. **Diagnostics are pending codegen.** expr.ts and closure.ts each have a
   `declare module "../diagnostics.ts"` block marked `PORT(gen): pending root`. The blocks declare
   `<Name>_diagnostic` / `UseConstGenericArg_subdiagnostic` with the generator's signatures. The call sites are
   already in their final form: `this.dcx().emit_err(diagnostics.X_diagnostic({ .. }))`.
   - tsc does **not** flag a stale augmentation once the real export exists; the signatures are identical, so
     they merge.
   - So **delete both blocks by hand** when diagnostics.ts re-exports diagnostics.gen.ts.
   - Until then a call would be a TypeError, but nothing reaches lowering (`lower_to_hir` is unported).
4. **lib.rs types are typed views.** lib.ts still aliases `PerOwnerLoweringState` and `TryBlockScope` to
   `unknown`. expr.ts has two local typed views of them, `PerOwnerLoweringStateView` (the fields
   `owner` / `ident_and_label_to_local_id` / `attrs`, plus `owner_id()`) and `TryBlockScopeView`, both copied
   from the generator's output. The uses cast `this.curr_owner` / `this.try_block_scope` to these views.
   - The casts become no-ops once lib.gen.ts exists; remove the views then.
   - Values of the other `unknown` lib.rs enums are written as the generator's shapes:
     - `ImplTraitContext::Disallowed(ImplTraitPosition::Path)` → `{ $: "Disallowed", _0: "Path" }`;
     - `ParamMode` / `GenericArgsMode` / `AllowReturnTypeNotation` / `FnDeclKind` / `DiscardParams` → string
       literals.

     tsc will check all of them after codegen.
5. **Representation:**
   - Arenas are erased.
   - Copies of `Copy` HIR values are identity (hir-visit decision).
   - AST `.clone()` / `*copy` are `clone_Expr`, `clone_Param` and `token.clone_Lit`.
   - `MoveExprState::default()` is `{ occurrences: [] }`.
   - `NodeMap` index (`initializers[&id]`, `ident_and_label_to_local_id[&loop_id]`) panics with std's
     `no entry found for key` (local helper `map_index`).
   - A Rust binding that shadows a same-scope name gets a trailing `_` (file header).
6. **`Vec<Option<MoveExprState>>::pop()`.** This is `Option<Option<..>>`. The empty-stack `span_bug!` is a
   length check before `pop()`.

## For root
1. **Codegen set `rustc_ast_lowering`.** Add the two visitor `hand` entries from decision 1. After generating:
   - replace the decision-2 block with `export * from "./expr.gen.ts"`;
   - delete the decision-3 `declare module` blocks in expr.ts and expr/closure.ts;
   - drop the `*View` casts from decision 4.
2. **The harness-w13 merge will conflict** in `harness/suites.ts`. main's tydump/thirdump `SUITES.push` and
   harness-w13's hir suites are added at the same place. The resolution is both blocks, with a `);` between
   them.
