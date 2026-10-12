# Handoff: pprust-ei (wave 6): rustc_ast_pretty `pprust/state/expr.rs` + `pprust/state/item.rs`

Branch `lane/pprust-ei` (based on main 71559cd).

## Evidence
- **Coverage** (`bun scripts/coverage.ts --missing`): `pprust/state/expr.rs` 24/24, `pprust/state/item.rs` 25/25.
- **`coverage.ts --check`**: `markers ok (2558; vendor 2048)`.
- **Typecheck**: `bunx tsc --noEmit -p .` clean.
- **Unit tests**: `RUST_TS_REQUIRE_PROBES=1 bun test src tools`: 745 pass, 1 skip (not in this crate), 0 fail.
- **Difftest sample**: `RUST_TS_AGENT=pprust-ei bun scripts/difftest.ts --suite lex --sample 200`: 200/200 MATCH
  (run `20261012-221950-pprust-ei-0h7v`).
- **Entry modules**: `state/expr.ts`, `state/item.ts`, `state.ts`, `pprust/mod.ts`, `rustc_ast_pretty/lib.ts` each load
  cleanly as entry.
- **`pprust/tests.test.ts`**: `test_fun_to_string` and `test_variant_to_string` un-skipped and passing (all 3 tests run).
- **`pprust/state/expr_item.test.ts`** (158 tests), all against real rustc output:
  - Fixture `state/expr_item.oracle.json`, produced by `state/expr_item.oracle.rs.txt` (rustc-dev scratch program;
    build/run commands in both file headers). It parses each snippet with `rustc_parse` (edition 2024) and records
    `pprust::{expr_to_string, item_to_string, crate_to_string_for_macros}` plus the AST as JSON.
  - Chosen approach: **JSON ASTs** (not hand-built). The JSON is emitted directly in the rust-ts AST shape (rust-ts
    mirrors rustc_ast field-for-field), so the TS side is a ~40-line generic reviver: `{"#":"<Struct>"}` ->
    `Object.create(<generated class>.prototype)` (plain object for interface types), `{"#sym"}`/`{"#ident"}`/`{"#bytes"}`
    interned, `"§SP"`/`"§ID"`/`"§AT"` -> `DUMMY_SP`/`DUMMY_NODE_ID`/`AttrId(0)`, `null` -> `undefined`. The Rust
    serializer panics on any node outside its subset, so the fixture can't drift silently. Delete the test and both
    fixture files once the parser lands.
  - 95 expressions: precedence/parenthesization through `FixupContext` (cases with `unparen: true` have every
    `ExprKind::Paren` stripped before printing, like upstream's `pprust-parenthesis-insertion` test: binary ops on
    both sides, assignment chains, casts before `<`/`<<`, unary/prefix, ranges, struct literals in conditions,
    statement-boundary `match`/`loop`/`if`, closures/`return` as callee, attrs on binary exprs), closures (`move`,
    `async`, `static`, `for<'a>`, return types), `match` (guards, `if let` guards, or-patterns, unsafe-block arms,
    postfix `.match`), if/else-if chains, let-chains, `while let`, `for`, labeled `loop`/block/`break`/`continue`,
    blocks with inner attrs, method calls/turbofish/`.await`/`?`, field/index, ranges incl. `0. ..1.`, casts,
    struct literals with base/`..`, tuples/arrays/repeat, macro calls, qualified paths, all literal kinds, line
    breaking of long calls, `const {}`, `builtin #` offset_of/type_ascribe/wrap_binder/unwrap_binder, `gen`/`async gen`
    blocks, `try`, `do yeet`, `become`, `.use`, `&pin`, bare `yield`/`return`/`break`, assignment destructuring.
    Plus hand-built in the oracle program (the parser never produces them): 5 `FormatArgs` (template escaping incl.
    grapheme-extended chars and braces, every format option, `Err` indices, `$` width/precision args, every trait)
    and 1 `IncludedBytes`.
  - 61 items: fn with lifetimes/type/const generics, bounds, where clauses (incl. `for<'b>`, `'a:`), patterns in
    params; struct/tuple struct/unit struct/enum (discriminants)/union; trait (assoc types/consts/fns, GAT where
    clauses), `auto`/`unsafe`/`const` traits, trait alias; impls (`unsafe`, negative, inherent, `const impl`,
    `default fn`, assoc type); use trees (nested, `self`, glob, rename, single-item and empty braces); `mod` inline /
    unloaded / with inner attrs; extern blocks (`unsafe extern`, `safe`/`unsafe` statics, foreign types, variadics,
    macro calls); `macro_rules!`; static/const/`static mut`; type alias; `extern crate .. as`; `async unsafe`/`const`/
    `extern "C"` fns; attributes on items and fields; `pub(in path)`; let-else, item stmts, macro stmts, empty stmts;
    delegation (`reuse` single/qself/list/glob, in impls); const block item; long struct/signature wrapping;
    `for<'a> unsafe extern "C" fn` types.
  - 1 crate through `crate_to_string_for_macros` (inner attrs, doc comments, use, struct, trait impl with `write!`).
  - Sensitivity checked: corrupting one expected string makes exactly that test fail.

## Files touched
- New: `src/rustc_ast_pretty/pprust/state/expr.ts`, `src/rustc_ast_pretty/pprust/state/item.ts`,
  `src/rustc_ast_pretty/pprust/state/expr_item.test.ts`, `state/expr_item.oracle.json`, `state/expr_item.oracle.rs.txt`.
- `src/rustc_ast_pretty/pprust/state.ts`: removed the `interface State` declarations and the 13 `unported(..)`
  placeholders at the end (now declared in `declare module "../state.ts"` blocks in expr.ts/item.ts); dropped the
  unused `unported` import; header comment updated.
- `src/rustc_ast_pretty/pprust/mod.ts`: side-effect imports `import "./state/expr.ts"; import "./state/item.ts";`
  after `./state.ts` (mod.ts is what every consumer, including `lib.ts`, goes through).
- `src/rustc_ast_pretty/pprust/tests.test.ts`: un-skipped `test_fun_to_string`, `test_variant_to_string`; removed
  the pending note.

## unported(...)
None. No `unported(...)` remains in `rustc_ast_pretty`.

## PORT decisions
- `impl State` in other files: PORTING §5 pattern (`declare module "../state.ts" { interface State {..} }` +
  `State.prototype.x = function (this: State, ..)`). Private upstream methods are declared too (interface members
  can't be private).
- `Self::cond_needs_par` (associated fn without `self`) -> module-level function in expr.ts (statics can't be added
  to the class from an extension module).
- `ExprPrecedence` `<`/`<=` (derived `PartialOrd`) -> local `lt`/`le` over the generated `ExprPrecedence_discriminant`.
- `char::escape_debug` (in `reconstruct_format_args_template_string`) -> local `char_escape_debug`, the same table
  as state.ts's `str_escape_debug` (`DEBUG_ESCAPE_UNICODE`); verified against rustc by the FormatArgs fixtures.
- `p.format_options != Default::default()` -> local `format_options_is_default` (derived `Default` = every field
  `None`/`false`, derived `PartialEq`).
- `let (Ok(n) | Err(n)) = index` -> `index._0`.
- `ast::Generics::default()` -> local `generics_default()` in item.ts (same construction as state.ts's `print_ty_fn`).
- `enum DelegationKind<'a>` -> local `$`-tagged type.
- `body.as_ref().map(|body| (body, self.head("")))` -> `body === undefined ? undefined : [body, this.head("")]`
  (`head` is only evaluated when there is a body, as upstream).
- Matches with guards/fallthrough arms (`print_else`, the `(lhs.kind, op)` match in `print_expr_binary`,
  `Path(None, ..)`/`Path(Some, ..)`) -> if-chains in upstream arm order.
- `impl_generics` closure in the `Impl` arm -> local arrow fn taking `this_: State`.

## For root
- `docs/claims/pprust-ei.md` can be deleted.
- Scratch oracle sources: `$RUST_TS_DATA/tmp/pprust-ei/oracle/` (main.rs, out.json).
