# Handoff: parser-item (wave 6c parser porter)

Branch `lane/parser-item`. Ports `compiler/rustc_parse/src/parser/item.rs` (3006 lines) into the stub
`src/rustc_parse/parser/item.ts`. No `decls.ts` changes were needed: every signature in the contract fit.

## Files
- **Ported:** `src/rustc_parse/parser/item.ts`. All 80 `impl Parser` methods plus `field_def_extras`
  (module-level fn, contract rule 3), in upstream order, with markers. The `unported_methods` call is gone.
- **Tests:** `src/rustc_parse/parser/item.test.ts` and its fixture `item_oracle.json` (55 cases).
- **Outside my ownership (minimal, forced by "tests green"; please confirm):**
  - `src/rustc_parse/parser/parser_core.test.ts`: the `PENDING` reason of `outer_attrs_doc` and
    `outer_attrs_inner_doc_misplaced` changed from `item::Parser::parse_item` (now ported) to
    `diagnostics::Parser::recover_vcs_conflict_marker` (what they reach now).
  - `src/rustc_driver_impl/driver.oracle.test.ts`: the six `PENDING` entries naming
    `item::Parser::parse_crate_mod` now name `diagnostics::Parser::maybe_consume_incorrect_semicolon`.
  - Lanes parser-diag and parser-ptg edit the same two lists, so merging them conflicts there (only there).
    Take whatever the integrated tree reaches.

## Evidence
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test src tools`: 1068 pass, 0 fail, 1 skip. The skip is pre-existing:
  main without this branch's changes has the same one. No todo, no `.only`.
- `bun scripts/coverage.ts --check`: `markers ok (3160; vendor 2278)`.
- `bun scripts/coverage.ts --missing compiler/rustc_parse/src/parser/item.rs`: **81/81 ported**.
- `RUST_TS_AGENT=parser-item bun scripts/difftest.ts --suite tokens --sample 200`: 200/200 MATCH
  (run `20261013-004654-parser-item-ck2a`).
- `--suite parse --sample 50` on this branch alone: 1 MATCH, 49 UNPORTED, 0 DIFF. Every case stops in
  diagnostics.rs (`maybe_consume_incorrect_semicolon`, `recover_vcs_conflict_marker`), because
  `parse_mod`/`parse_item_` call them first.

### Scratch integration (not committed)
I built a detached worktree with this branch plus lanes parser-diag, parser-ptg, parser-fn-asm,
parser-pat-stmt and parser-expr merged in. Their heads at 00:48 were 175c21e, d133d6a, 5b126f8, b9260fb
and 5f38254. In that worktree:
- `item.test.ts` with `PENDING` emptied: **55/55 cases match rustc byte for byte** (stdout AST tree,
  stderr, exit code).
- `--suite parse --sample 200`: **200/200 MATCH** (run `20261013-004846-parser-item-qt60`).
- `--suite parse --filter tests/ui/parser/` (all 929 files): **928 MATCH, 0 DIFF, 1 TIMEOUT**
  (run `20261013-004908-parser-item-7856`). The timeout is not in the parser; see finding 1.
- Earlier, against expr's WIP head 766340b: `--filter tests/ui/macros/ --sample 400` gave 248 MATCH,
  0 DIFF. `--sample 1500` gave 357 MATCH, 0 DIFF. All UNPORTED were in expr.rs.

**Driver check.** On this branch alone, no tests/ui file gets through `-Zunpretty=ast-tree`: even an
empty crate reaches `maybe_consume_incorrect_semicolon`. With the five lanes above merged, every
sampled file matches, as the parse runs above show.

## Tests (`item.test.ts`)
- **How it runs.** Each case is a whole crate, run through the driver as a subprocess:
  `src/rust_ts/main.ts --edition=2021 -Zunpretty=ast-tree <name>.rs`, so the path is `passes::parse` →
  `parse_crate_mod` → `{krate:#?}`. stdout, stderr and the exit code must equal the fixture.
- **The fixture.** `item_oracle.json` holds `rustc +nightly` output at the pin. To regenerate it, run
  `RUST_TS_WRITE_ORACLE=1 bun test src/rustc_parse/parser/item.test.ts`; it checks the
  `rustc -vV` commit-hash first. Scratch files go in `$RUST_TS_DATA/tmp/parser-item-test/<agent>/`.
- **PENDING** (same convention as parser_core):
  - A pending case must stop with exactly the listed `rust-ts: unported: <what>` after printing a prefix
    of the oracle's stdout and stderr.
  - A pending case that matches fails the test.
  - On this branch: 54 cases are listed → `diagnostics::Parser::maybe_consume_incorrect_semicolon`, and
    `inner_attrs` → `path::Parser::parse_path`.
  - **Root:** once diag, ptg, fn-asm, pat-stmt and expr are merged, empty `PENDING`. All 55 cases matched
    in the scratch integration.
- **Coverage:**
  - `mod` items, including `unsafe mod`.
  - Use trees: glob, nested, `self`, rename, `as _`, `::*`, `::{}`. Errors: glob not last, single colon,
    attributes inside the tree (`AttrInUseTree` suggestion), `import` recovered as `use`.
  - `extern crate`, plain, renamed and `self`, and the dashed name.
  - Structs: unit, tuple, named, where-clause on either side, default field values (named and tuple),
    `unsafe` fields.
  - Enums: discriminants, attributes on variants, `enum struct`, `a: u8` (suggests struct), nested ADT.
  - Unions. Errors: no body, a bad token after a struct name.
  - Traits: assoc types, consts and fns with defaults, `auto`, `unsafe`, `const trait`, trait alias,
    `x: u8` in a trait, `static` in a trait.
  - Impls: inherent and trait, `!`, `default`, `const impl`, `unsafe`, where-clause, `default fn`.
    Errors: `impl S;`, inherent-impl modifiers (E0197 etc.), `impl for S`.
  - `pub` on impl items. This is not a parser error; the tree is compared.
  - Extern blocks with `safe`/`unsafe` items, `type`, `static mut`, and `const`/`mod` inside `extern`.
  - Macros: `macro_rules!` with `{}` and `()` bodies, macro calls in item position, macros 2.0, missing
    bang, a call without a semicolon, `pub` on macro calls and `macro_rules`.
  - Visibility: `pub`, `pub(crate|self|super|in path)`, and the 2015-style `crate fn` error.
  - `unsafe(..)` attributes, doc comments (line and block), inner attributes and `//!`, a dangling doc
    comment or attributes at EOF.
  - Statics and consts: `static`, `static mut`, `const`, `const _`, type aliases with a where-clause,
    `const { }` block items, a missing type (stashed `ItemNoType`), `const mut`, `reuse`.
  - Recovery: missing `fn` keyword, missing `struct` keyword, `struct S;;`, `enum E { A = }`, `let` at
    item level, `;`-separated fields, `fn` inside a struct, `default struct`, `pub` at EOF.

## `unported(...)` left
None in item.ts. Everything it calls belongs to other lanes' files (diagnostics, path, ty, generics,
function, expr, pat, stmt), and all of those were ported in the scratch integration.

## PORT decisions (please record)
1. **`Generics::default()` / `WhereClause::default()`** (`#[derive(Default)]`) are local helpers
   `generics_default` / `where_clause_default`, following the precedent in
   `rustc_ast_pretty/pprust/state/item.ts`. Candidates for codegen; generics.rs may need the same.
2. **`parse_item_common`'s `eat_metavar_seq(MetaVarKind::Item, ..)`.** The inner
   `Option<Box<Item>>` is boxed as `{ _0 }`, so that `Some(None)` still reaches
   `expect("an actual item")`. The contract assumes `T` is never undefined.
3. **`parse_item_kind`.**
   - `def: &mut Defaultness` is `MutRef` (contract); `def_()` is the `mem::replace` closure.
   - The `if let` arms of the `else if` chain assign in the condition (`const_yes_span` helper for
     `Const::Yes`).
   - `debug!` is dropped; a comment stands in for it.
4. **Non-short-circuit `|`** in `parse_static_item` and `parse_const_item`: every `check(..)` runs, in
   order, as upstream. The checks record expected tokens.
5. **`parse_field_ident`'s `if let` chain** is written out with a flag. Its `else`
   (`restore_snapshot`) runs whenever any link fails, as upstream.
6. **The `const SUFFIXES` / `const ALL_QUALS` locals** are module-level frozen arrays, defined just
   above their fns. Only `kw` from rustc_span is read at load time.
7. **Small std equivalents:**
   - `Result::is_ok_and` is a local helper.
   - `unwrap_err()` on `Ok` panics without the `Ok` value's Debug (unreachable there).
   - `str::trim_end` on `vis_to_string` output is JS `trimEnd`.
   - `Ident::to_string()` for `edit_distance` is `display_Ident`.
   - `Edition >=` is `Edition_discriminant`.
   - `unwrap()` of `parse_ident_common` is `unwrap_result(.., debug_Diag)` (the result.test guard).
8. **`write!(fixed_name, "_{}", part.name)`** is string concatenation of `Symbol.as_str`.

## Findings for root
1. **Perf, std/fmt.ts, not the parser.** The `{:#?}` builders (`debug_struct`/`debug_tuple` + `pad`)
   re-pad already formatted child strings at every level. That is cubic in nesting depth: a call nested
   800 deep takes 10 s under `-Zunpretty=ast-tree` but 0.13 s under `-Zunpretty=normal`. Because of
   this, `tests/ui/parser/survive-peano-lesson-queue.rs` (8 MB, calls nested about 2000 deep) times out
   in the parse suite. Fix: a streaming PadAdapter, writing into a buffer with an indent state, as std
   does.
2. **The skip.** The one skip in `bun test src tools` is pre-existing and not from this lane.
3. Delete `docs/claims/` for parser-item, if one was created for this lane, on integration.
