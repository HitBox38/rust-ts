# Handoff: parser-expr (wave 6c parser porter): parser/expr.rs, parser/expr/diagnostics.rs

Branch `lane/parser-expr` (based on main b9444b5; not merged with later main).

## Files touched
- `src/rustc_parse/parser/expr.ts`: all of expr.rs (stub replaced; no `unported_methods` left).
- `src/rustc_parse/parser/expr/diagnostics.ts`: all of expr/diagnostics.rs (stub replaced).
- New `src/rustc_parse/parser/expr.test.ts` and its fixture `src/rustc_parse/parser/expr_oracle.json`.
- Nothing else (no decls.ts, generator, std, scripts or harness edits).

## Coverage (`bun scripts/coverage.ts --missing <file>`)
| file | fns ported |
|---|---|
| parser/expr.rs | 143/143 (incl. the nested `get_path_from_rhs`/`inner`/`find_let_some` and the local `FindLabeledBreaksVisitor::visit_expr`) |
| parser/expr/diagnostics.rs | 12/12 |

`bun scripts/coverage.ts --check`: `markers ok (3234; vendor 2278)`.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test src tools`: 1192 pass, 0 fail, 1 skip (pre-existing `test.skipIf(SKIP)` in
  rustc_lint_defs, also on main), 0 todo.
- `RUST_TS_AGENT=parser-expr bun scripts/difftest.ts --suite tokens --sample 200`: 200/200 MATCH
  (run `20261013-004603-parser-expr-b7tr`).
- **Scratch integration** (not committed; worktree `$RUST_TS_DATA/tmp/parser-expr/integ`, branch
  `scratch/parser-expr-integ` = main@0349d96 + lane/parser-expr + lane/parser-diag + lane/parser-ptg +
  lane/parser-pat-stmt + lane/parser-item as of 00:45, merged without conflicts, tsc clean):
  - all 181 expr oracle cases match with an empty PENDING;
  - `--suite parse --sample 200`: 200/200 MATCH (run `20261013-004711-parser-expr-integ-5w09`);
  - `--suite parse --sample 2000` (another seed): 2000/2000 MATCH (run `20261013-004726-parser-expr-integ2-8749`).

## Tests and how the expectations were obtained
- `expr.test.ts`: 181 oracle cases + a fixture-size check. Oracle = a rustc_private probe linked against
  `nightly-2026-10-11` rustc-dev (source in the fixture's `_probe`, cases in `_cases`, build/run commands in
  `_how`; scratch copy `$RUST_TS_DATA/tmp/parser-expr/probe/`). Each case parses `src` as `t.rs`
  (edition 2024 unless the ops line says `ed:2015/2018/2021`) with `new_parser_from_source_str` and runs ops
  against the real `Parser`: `expr` (`parse_expr`), `in_let`, `force` (`parse_expr_force_collect`), `anon`,
  `lit` (`parse_literal_maybe_minus`), `str_lit`, `tok`, `lints` (buffered lints: name + span). Results are
  `{:#?}` (the same Debug `-Zunpretty=ast-tree` prints), then stashed diagnostics are emitted; the full
  `-Zui-testing` stderr must match byte for byte.
- Coverage of the brief's list (case-name prefixes): every binary/assign operator's precedence and
  associativity, `as`, unary, `?`, `.await` (2015 vs 2018+); ranges; closures (`move`, `async`, `static`,
  `for<'a>`, `use`, `const`, ret ty with/without block, `move async` order error); if/else-if, let chains on
  2021 vs 2024, `||`/parens in let chains, `if x = y`, missing block/condition; match with guards, let guards,
  arms with/without commas, missing comma, `->` typo, `(pat if guard)`, missing braces, postfix match; labeled
  while/loop/for, labeled blocks, `'a: 1 + 2`, loop-else; break/continue/return with values and labels
  (incl. the `BREAK_WITH_LABEL_AND_LOOP` buffered lint); struct literals (base, rest, shorthand, `=`, `...`,
  parens, missing path, `_ {}`, missing comma) and `if S {} {}`; method calls with turbofish, generic field;
  calls/indexing; tuple fields incl. `x.0.1`, `x.0.1.2`, `x.1e2`, suffixes; async/gen/async gen/try blocks per
  edition, `try {} catch`, `do catch`, `unsafe`, `const`; `yield`, `become`, `do yeet`, `box`; literal
  suffixes, bad suffix, `.5`; macro calls incl. qpath; arrays/tuples/parens; qpath; `as usize < b`,
  `<<`, postfix after cast; recovery: `a < b < c`, `a < b > c`, `a == b == c`, missing operand, `===`, `<>`,
  `<=>`, `and`/`or`, `++`/`--`, `~`, `not`, leading `+`, `->` call, `<-`, `&'a x`, `builtin #` forms,
  `move(x)`, outer attrs, `'a` unclosed char, C arrays, `await x`, bad qpath `[u8]::f()`.
- **Negative control:** corrupting every expectation fails all 181 cases (checked in the scratch merge).
- **PENDING** (178 of 181 on this branch alone): each case must throw exactly the listed `Unported` until the
  owning lane lands (path 108, diagnostics 29, stmt 15, pat 11, ty 10, generics 5). In the scratch merge all of
  them match, so root can empty PENDING once parser-diag, -ptg, -pat-stmt and -item are integrated (the test
  fails for each case that starts matching while still listed).

## `unported(...)` left
None in expr.ts / expr/diagnostics.ts. Indirectly the parser paths reach other lanes' stubs (see PENDING).

## PORT decisions (please record)
1. `std::ops::Bound<T>` stays the type in expr.ts (contract); `Bound_Unbounded` is a frozen singleton.
   `ExprPrecedence` `<`/`<=` use the generated `ExprPrecedence_discriminant` (derived `PartialOrd`).
2. `mem::replace(self, snapshot)` (parse_assoc_op_cast) is the local `mem_replace_parser`: the current
   fields move into a fresh `Parser` object, `self` takes the snapshot's fields; `*self = snapshot` is
   `Object.assign(this, snapshot)` (contract rule 6).
3. `macro_rules! make_it` (parse_expr_prefix) is a local closure; `maybe_recover_from_interpolated_ty_qpath!`
   (mod.rs:165) is expanded inline at the top of `parse_expr_bottom`.
4. The `T: RecoverQPath` table for `Box<Expr>` is `RecoverQPath.Box(RecoverQPath.Expr)`, built per call
   (`expr_recover_qpath()`), since the tables live in diagnostics.ts (init order).
5. `break_up_float`'s local `#[derive(Debug)] enum FloatComponent` is a local union + Debug (only used in its
   panic text); `{c:?}` uses `debug_char`.
6. `char::is_numeric` (recover_after_dot) is `/^\p{N}$/u`; `str::trim` (report_inc_dec_op) is a local
   `str_trim` over `std/char.ts is_whitespace`. Both std candidates.
7. **`CondChecker` is hand-written** in expr.ts (`class CondChecker extends MutVisitor`, same fields in the
   same order, `static new`), shadowing the generated class of expr.gen.ts: `impl MutVisitor for CondChecker`
   requires extending the `MutVisitor` base class (mut_visit.ts convention). Root: mark `CondChecker` as
   `hand` in tools/codegen/types.sets.json (or keep the shadow). `FindLabeledBreaksVisitor` (parse_expr_labeled)
   is a local `class extends Visitor<ControlFlow<null>>`.
8. Match arms with guards that fall through (`Binary(Or) if ..`, `Paren if ..` in CondChecker; `Plus if ..`,
   `Ident if ..` in parse_expr_prefix) are if-chains in upstream arm order, so a failed guard reaches the
   later arms as in Rust.
9. `unreachable!("did not expect {:?} ..")` in parse_assoc_op_cast prints `debug_ExprKind(.., PLAIN)`.

## Contract issues for root
1. **`op_can_continue_stmt_expr_unambiguously`**: the parser-core stub declared `(token: Token)`; upstream
   (expr/diagnostics.rs:301) takes `op: AssocOp`. Ported with the upstream signature. lane/parser-pat-stmt's
   stmt.ts already calls it with an `AssocOp` through an `as unknown as` cast (its `PORT(contract)` note), which
   can now be dropped.
2. decls.ts: no changes needed; every expr.rs / expr/diagnostics.rs method uses the declared signature.

## For root
1. Record decisions 1-9; delete `docs/claims/wave6c-parser-expr.md` on integration.
2. After integrating the other wave-6c lanes, empty `PENDING` in `expr.test.ts` (all 181 cases matched in the
   scratch merge).
3. Delete the scratch worktree/branch: `git worktree remove $RUST_TS_DATA/tmp/parser-expr/integ &&
   git branch -D scratch/parser-expr-integ`.
