# Handoff: parser-ptg (wave 6c parser porter): parser/path.rs, ty.rs, generics.rs

Branch `lane/parser-ptg` (based on main b9444b5).

## Files touched
- Ported (stubs filled, `unported_methods` calls removed):
  - `src/rustc_parse/parser/path.ts`: `PathStyle.has_generic_ambiguity` + all 18 `impl Parser` fns.
  - `src/rustc_parse/parser/ty.ts`: `RecoverReturnSign.can_recover`, the free fn `can_begin_dyn_bound_in_rust_2015`
    (module-level, not exported) + all 48 `impl Parser` fns.
  - `src/rustc_parse/parser/generics.ts`: all 16 `impl Parser` fns + the free fn
    `suggest_replacing_equality_pred_with_assoc_item_constraint` (module-level, not exported).
- New tests: `src/rustc_parse/parser/{path,ty,generics}.test.ts`, fixture `src/rustc_parse/parser/ptg_oracle.json`.
- **Outside my files (minimal, for a green suite):** `src/rustc_parse/parser/parser_core.test.ts` PENDING:
  `attr_outer`, `attr_inner`, `attr_unsafe` removed (they were pending on `path::parse_path` and now match the
  oracle byte for byte); `attr_eq` now reaches `rustc_parse::parser::expr::Parser::parse_expr_force_collect`
  (updated). This is exactly the update the parser-core PENDING convention asks for when a lane lands.
- `decls.ts`: no change needed; every signature fit.

## Evidence
- Coverage (`bun scripts/coverage.ts --missing`): path.rs 19/19, ty.rs 50/50, generics.rs 17/17.
  `--check`: `markers ok (3165; vendor 2278)`.
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test src tools`: 0 fail, 1 skip (pre-existing, not in rustc_parse).
  (One run showed a flaky `vendor/termize` "no fd leak under a pty" failure under load; it passes on rerun and in
  isolation, unrelated.)
- `RUST_TS_AGENT=parser-ptg bun scripts/difftest.ts --suite tokens --sample 200`: 200/200 MATCH
  (run `20261013-004007-parser-ptg-xkvt`).
- Entry points: `parser/path.ts`, `parser/ty.ts`, `parser/generics.ts`, `rustc_parse/lib.ts` each load as the entry
  module; with lib.ts loaded the ported methods are the real ones on `Parser.prototype`.

## Tests and how the expectations were obtained
- **Oracle:** a rustc-dev probe against `nightly-2026-10-11` (source in the fixture's `_probe`, cases in `_cases`,
  build/run commands in `_how`; scratch copy `$RUST_TS_DATA/tmp/parser-ptg/probe/`, `mkfixture.py` writes the
  fixture). Each case parses `src` as `t.rs` (edition per case, default 2024, `new_parser_from_source_str`,
  `StripTokens::Nothing`) and runs an op script: `ty` (`parse_ty`), `path:<Style>` (`parse_path`), `tok`, `bump`,
  `item_generics` (`parse_item` of a `fn`, prints its `Generics`). The TS side of `item_generics` is the case's `ts`
  script: bump to the generics, `parse_generics`, bump over `()`, `parse_where_clause`, then print the `Generics`
  with that where clause. Compared byte for byte: the `{:#?}` Debug of each result, the next token, `fatal`, and the
  full `-Zui-testing` stderr.
- **136 cases** (path 36, ty 79, gen 21) covering: plain/global/keyword-segment paths, every `PathStyle`, `::<>`,
  lifetime/type/const args, assoc equality/bound/GAT/const constraints, parenthesized and `(..)` args (+ `-> T`
  error), unterminated `Vec<T`, `for<..>` on assoc, missing type after `=` (incl. `r#type`), lifetime in equality,
  `;` separator, leading `<<<<` recovery (and the gap case), >10 nested unclosed `f::<` (fatal); never/infer/tuple/
  paren/slice/array (`[u8, 4]` recovery), raw pointers (missing `const`/`mut`, C-style `const *`), references with
  lifetimes, `pin`, `&mut 'a T` / `&mut'a T` / `&mut 'a + T`, `&dyn mut`, fn pointers (`extern`, variadic, `for<'a>`,
  `fn<'a>` generics recovery, `fn() -> impl`), `dyn`/`impl` bounds with `?`, `!`, `~const`, `[const]`, `const`,
  `async` (2015 and 2018+), polarity+modifier / binder+polarity / binder-after-modifier errors, lifetime bounds with
  modifiers, parenthesized bounds, use-bounds, `for<'a>` bare/dyn/impl (transpose recovery), qpaths (nested,
  `<T>:X` recovery), bare lifetimes in 2015/2021 (`'a mut T` -> `&` suggestion), `(Trait) + Send`,
  `&dyn (A + B)`, type macros, unsafe binders, `typeof`, C-variadics, `impl 'a Sized`, `dyn A + dyn B`, 2015 `dyn`
  as path, `impl &Trait`, `impl fn(..)`, `FnOnce<'a>(..)`, `u8?`, `&Trait + Send`; generics: none/simple/lifetimes/
  bounds/const params with defaults, where clauses (region, bound, `for<'a>`, trailing comma), `Self` param,
  lifetime default, `const N` without type, `Const` typo, `T: impl Trait`, assoc-type bounds, `where:`, `where<'a>`,
  `=`/`==` equality predicates with the suggestion, duplicate `where`, unclosed `<T(`, `f::<'a>`, attributes
  without/after params, attributes and trailing doc comment in where clauses.
- **Now (this branch = main + my files):** 9 cases match; the other 127 are PENDING, each asserting the exact
  `Unported` of another lane's method (diagnostics.rs: `dcx`, `create_snapshot_for_diagnostic`,
  `expect_gt_or_maybe_suggest_closing_generics`, `check_trailing_angle_brackets`, ...; expr.rs: `is_builtin`,
  `parse_expr_res`, ...). None points into path/ty/generics.
- **Validation beyond PENDING (scratch, not committed):** in a scratch worktree with lanes parser-expr, parser-fn-asm,
  parser-item, parser-pat-stmt, parser-tests merged plus a throwaway port of the needed diagnostics.rs subset,
  **123/136 match, 0 mismatches**; the remaining 13 stop in still-unported `expr/diagnostics` (`recover_from_alpha_logic_op`,
  `reject_dotdotdot_expr_op`, on the older expr branch) and `diagnostics::try_macro_suggestion`.
- **Negative control:** appending a character to every expected stderr fails exactly the 9 matching cases.

## `unported(...)` left
None in my three files. Every remaining `Unported` on these paths is another lane's method (see PENDING lists).

## PORT decisions (please record)
1. `maybe_recover_from_interpolated_ty_qpath!` (parser/mod.rs:165 macro) is expanded in place in `parse_ty_common`
   (the expr lane expands its own use).
2. `mem::replace(self, snapshot.unwrap())` in `parse_angle_args_with_leading_angle_bracket_recovery`: the current
   state moves into a fresh `Parser` object (`Object.assign(Object.create(Parser.prototype), this)`) and `this` takes
   the snapshot's fields with `Object.assign` (as `restore_snapshot`); the snapshot is `clone_Parser(this)`.
3. `TraitBoundModifiers == TraitBoundModifiers::NONE` (derived `PartialEq`) is a local `TraitBoundModifiers_eq` in
   path.ts (compares the three tags and their span payloads); candidate for codegen `_eq`.
4. `TraitBoundModifiers::NONE` used as a value is `clone_TraitBoundModifiers(TraitBoundModifiers.NONE)` (Copy AST
   object, PORTING §8). Note `ast.ts` `Ty::to_bound`-like code (ast.ts:1211) passes the shared `NONE` directly.
5. `&mut length.value` (`check_mistyped_turbofish_with_multiple_type_params`) is `field_mut(length, "value")`
   (std/mut_ref.ts); `&mut impl_dyn_multi` is a local `{ value: false }`.
6. `str::to_ascii_lowercase` is a local helper in generics.ts (std candidate).
7. `self.check(Colon) | self.check(Eq)` (non-short-circuit) keeps both calls.
8. `match` arms with `if let` guards (`recover_fn_call_leading_path_sep`, `expr_is_valid_const_arg`,
   `parse_paren_start_ty`, `parse_trait_bound`'s indirection recovery, the free equality-suggestion fn) are if-chains
   in arm order; a failing guard falls through exactly as upstream.
9. `parse_trait_bound`'s `if .. && let Some(path) = self.recover_path_from_fn()` let-chain: when the recovery returns
   `None` the next `else if` branch is taken (as upstream).
10. `Result::unwrap_err()` on `self.unexpected()` panics with upstream's message (`..: ()`);
    `expect_keyword(..).unwrap()` is `unwrap_result(.., debug_Diag)`.

## For root
1. Record the decisions above; delete `docs/claims/wave6c-parser-ptg.md` on integration.
2. When diagnostics/expr/function/pat/item lanes land, re-run `bun test src/rustc_parse/parser/{path,ty,generics}.test.ts`
   and drop each case that starts to match from that file's `PENDING` (the test fails until you do).
3. std candidates: `to_ascii_lowercase`; codegen candidate: `TraitBoundModifiers_eq` (derived PartialEq).
